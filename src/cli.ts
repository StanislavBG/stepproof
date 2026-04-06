#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseScenario } from './core/scenario-parser.js';
import { runScenario } from './core/scenario-runner.js';
import { writeJsonReport } from './reporters/json-reporter.js';
import { printReport, printProgress, formatComparison } from './reporters/terminal-reporter.js';
import { formatSarif } from './reporters/sarif-reporter.js';
import { formatJunit } from './reporters/junit-reporter.js';
import * as fs from 'node:fs';
import { guard, validate } from '@bilkobibitkov/preflight-license';
import { runInit } from './commands/init.js';
import { runView } from './commands/view.js';
import { runHistory } from './commands/history.js';
import { saveReport } from './commands/results-store.js';
import { sendTelemetry } from './telemetry.js';
import { saveBaseline, loadBaseline, compareWithBaseline, resetBaseline, listBaselines, loadBaselineYaml } from './baseline.js';
import { formatPRComment } from './reporters/github-comment.js';
import { runDiff } from './commands/diff.js';
import { clearCache } from './cache.js';
import { runComparison, parseProviderSpecs } from './commands/compare.js';
import { loadDataset } from './dataset.js';
import { startWatch } from './commands/watch.js';

const CLI_VERSION = '0.2.21';

/* ── Usage-based monetization (Preflight Suite — shared) ────────────── */

const TOOL_NAME = 'stepproof' as const;
const FREE_MONTHLY_LIMIT = 50;
const FREE_DAILY_LIMIT = 3;
const UPGRADE_URL = 'https://buy.stripe.com/3cIbJ3fA8am122VcwE8k804';

// Shared suite directory
const SUITE_DIR = path.join(os.homedir(), '.preflight-suite');
const SUITE_USAGE_FILE = path.join(SUITE_DIR, 'usage.json');
const SUITE_LICENSE_FILE = path.join(SUITE_DIR, 'license.json');

// Legacy per-tool config dir (kept for backwards-compat reads)
const CONFIG_DIR = path.join(os.homedir(), '.config', 'stepproof');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface SharedUsage {
  month: string;  // YYYY-MM
  total: number;
  day: string;       // YYYY-MM-DD
  day_total: number; // resets each calendar day
  tools: {
    stepproof: number;
    'agent-comply': number;
    'agent-gate': number;
  };
}

/** Read license key: env var → shared suite → legacy tool config */
function getLicenseKey(): string | undefined {
  const envKey = process.env.STEPPROOF_KEY;
  if (envKey?.trim()) return envKey.trim();
  try {
    if (fs.existsSync(SUITE_LICENSE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SUITE_LICENSE_FILE, 'utf8')) as { key?: string };
      if (parsed.key?.trim()) return parsed.key.trim();
    }
  } catch { /* ignore */ }
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as { key?: string };
      if (parsed.key?.trim()) return parsed.key.trim();
    }
  } catch { /* ignore */ }
  return undefined;
}

/** Check if user has a valid pro license */
function isProUser(): boolean {
  const key = getLicenseKey();
  if (!key) return false;
  const result = validate(key);
  return result.valid && result.tier !== 'free';
}

/** Read shared suite usage for the current month, resetting daily counter if needed */
function readSharedUsage(): SharedUsage {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentDay = new Date().toISOString().slice(0, 10);
  try {
    if (fs.existsSync(SUITE_USAGE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SUITE_USAGE_FILE, 'utf8')) as SharedUsage;
      if (parsed.month === currentMonth) {
        if (parsed.day !== currentDay) {
          parsed.day = currentDay;
          parsed.day_total = 0;
        }
        if (parsed.day_total === undefined) parsed.day_total = 0;
        return parsed;
      }
    }
  } catch { /* corrupted — reset */ }
  return { month: currentMonth, total: 0, day: currentDay, day_total: 0, tools: { stepproof: 0, 'agent-comply': 0, 'agent-gate': 0 } };
}

/** Write shared usage to ~/.preflight-suite/usage.json */
function writeSharedUsage(record: SharedUsage): void {
  try {
    fs.mkdirSync(SUITE_DIR, { recursive: true });
    fs.writeFileSync(SUITE_USAGE_FILE, JSON.stringify(record, null, 2), 'utf8');
  } catch { /* degrade gracefully */ }
}

/** Check free limit before a run. Returns true if allowed, false if blocked. */
function checkUsageLimit(): boolean {
  if (isProUser()) return true;
  const usage = readSharedUsage();
  if (usage.day_total >= FREE_DAILY_LIMIT) {
    process.stderr.write(
      `\n  You've used your ${FREE_DAILY_LIMIT} free checks today.\n` +
      `  Upgrade to Team tier ($49/mo) for unlimited daily checks: ${UPGRADE_URL}\n` +
      `  — or run \`stepproof activate <your-license-key>\` to activate.\n\n`
    );
    return false;
  }
  return true;
}

/** Increment usage after a successful free run and show a state-based CTA */
async function trackUsageAfterRun(): Promise<void> {
  if (isProUser()) return;
  const usage = readSharedUsage();
  usage.total += 1;
  usage.day_total += 1;
  usage.tools[TOOL_NAME] = (usage.tools[TOOL_NAME] ?? 0) + 1;
  writeSharedUsage(usage);

  const used = usage.total;
  const remaining = FREE_MONTHLY_LIMIT - used;

  // Show CTA only when >80% of monthly quota used (remaining < 10 of 50)
  if (remaining === 0) {
    process.stderr.write(
      `\n  ${used}/${FREE_MONTHLY_LIMIT} free runs used — next run will be blocked.\n` +
      `  Upgrade to Team tier ($49/mo) for unlimited runs: ${UPGRADE_URL}\n` +
      `  Already have a key? stepproof activate <key>\n\n`
    );
    await sendTelemetry({ command: 'cta_shown', success: true, version: CLI_VERSION, outcome: 'cta_shown', exit_code: 0, is_pro: false });
  } else if (remaining <= 10) {
    const runWord = remaining === 1 ? 'run' : 'runs';
    process.stderr.write(
      `\n  ${used}/${FREE_MONTHLY_LIMIT} free runs used this month — ${remaining} ${runWord} left.\n` +
      `  Upgrade to Team tier ($49/mo) for unlimited runs → ${UPGRADE_URL}\n` +
      `  Already have a key? stepproof activate <key>\n\n`
    );
    await sendTelemetry({ command: 'cta_shown', success: true, version: CLI_VERSION, outcome: 'cta_shown', exit_code: 0, is_pro: false });
  }
}

/* ── CLI ────────────────────────────────────────────────────────────── */

const program = new Command();

program
  .name('stepproof')
  .description('Regression testing for multi-step AI workflows. Not observability — a CI gate.')
  .version('0.2.21')
  .addHelpText('after', `
Examples:
  stepproof init                                        scaffold a starter scenario
  stepproof run ./scenarios/first-test.yaml             run one scenario
  stepproof run ./scenarios/                            run all scenarios in a directory
  stepproof run test.yaml --format sarif --output results.sarif  SARIF output for CI
  stepproof view                                        open latest report in browser
  stepproof history                                     list recent runs`);

program
  .command('init [dir]')
  .description('Scaffold a starter scenario in ./scenarios/first-test.yaml')
  .action(async (dir?: string) => {
    runInit(dir);
    await sendTelemetry({ command: 'init', success: true, version: CLI_VERSION, outcome: 'scaffold' });
  });

program
  .command('activate <key>')
  .description('Store a license key for unlimited runs (applies to all Preflight Suite tools)')
  .action(async (key: string) => {
    const result = validate(key);
    if (!result.valid) {
      process.stderr.write(`\nInvalid license key: ${result.reason}\n\n`);
      await sendTelemetry({ command: 'activate', success: false, version: CLI_VERSION, outcome: 'invalid_key', exit_code: 1 });
      process.exit(1);
    }
    try {
      fs.mkdirSync(SUITE_DIR, { recursive: true });
      fs.writeFileSync(SUITE_LICENSE_FILE, JSON.stringify({ key }), 'utf8');
      console.log(`\nLicense activated (${result.tier} — ${result.org}). Unlimited runs enabled across all Preflight Suite tools.\n`);
      await sendTelemetry({ command: 'activate', success: true, version: CLI_VERSION, outcome: 'license_activated', exit_code: 0, is_pro: true });
    } catch (e) {
      process.stderr.write(`\nFailed to save license: ${(e as Error).message}\n\n`);
      await sendTelemetry({ command: 'activate', success: false, version: CLI_VERSION, outcome: 'save_failed', exit_code: 1 });
      process.exit(1);
    }
  });

program
  .command('view [scenario]')
  .description('Open the latest HTML report in your browser')
  .action(async (scenario?: string) => {
    runView(scenario);
    await sendTelemetry({ command: 'view', success: true, version: CLI_VERSION, outcome: 'opened' });
  });

program
  .command('history [scenario]')
  .description('List recent runs with pass/fail, date, duration')
  .action(async (scenario?: string) => {
    runHistory(scenario);
    await sendTelemetry({ command: 'history', success: true, version: CLI_VERSION, outcome: 'listed' });
  });

program
  .command('run [scenario]')
  .description('Run a scenario YAML file and report pass rates per step')
  .option('-n, --iterations <number>', 'Number of iterations to run (overrides scenario file)', parseInt)
  .option('-o, --output <file>', 'Path for output file (JSON by default; SARIF or JUnit when --format is set)', 'stepproof-report.json')
  .option('--no-json', 'Skip JSON report output')
  .option('--quiet', 'Suppress terminal output (use with --output for CI)')
  .option('--format <format>', 'Output format: sarif, junit')
  .option('--report <format>', '(deprecated: use --format)')
  .option('--no-baseline', 'Skip baseline comparison and saving')
  .option('--no-cache', 'Disable LLM response caching')
  .option('--dataset <path>', 'CSV file with input rows — run scenario once per row')
  .action(async (scenarioPath: string | undefined, opts: {
    iterations?: number;
    output: string;
    json: boolean;
    quiet: boolean;
    format?: string;
    report?: string;
    baseline: boolean;
    cache: boolean;
    dataset?: string;
  }) => {
    // --report is deprecated; normalize to --format
    if (opts.report && !opts.format) {
      process.stderr.write('Warning: --report is deprecated, use --format instead\n');
      opts.format = opts.report;
    }

    if (opts.format && opts.format !== 'sarif' && opts.format !== 'junit' && opts.format !== 'github') {
      console.error(`\nError: --format must be "sarif", "junit", or "github", got "${opts.format}"`);
      process.exit(2);
    }

    // License gate — check before running the scenario (avoid wasted API calls)
    if (opts.format === 'sarif' || opts.format === 'junit') {
      guard('team', { feature: `--format ${opts.format}` });
    }

    // Read scenario YAML for baseline storage (before any mutation)
    let scenarioYaml: string | undefined;
    try {
      scenarioYaml = fs.readFileSync(path.resolve(process.cwd(), scenarioPath!), 'utf-8');
    } catch { /* will fail later in parseScenario */ }

    // Capture pro status once — used for telemetry throughout this command
    const isPro = isProUser();

    // Usage limit — check before running (avoid wasted API calls)
    const startMs = Date.now();
    if (!checkUsageLimit()) {
      await sendTelemetry({ command: 'run', success: false, version: CLI_VERSION, outcome: 'rate_limited', exit_code: 1, duration_ms: Date.now() - startMs, is_pro: isPro });
      process.exit(1);
    }

    // --format implies quiet (suppress terminal output) unless --quiet already set
    const isQuiet = opts.quiet || !!opts.format;

    if (opts.iterations !== undefined) {
      if (!Number.isInteger(opts.iterations) || opts.iterations <= 0) {
        console.error(`\nError: --iterations must be a positive integer, got "${process.argv[process.argv.indexOf('--iterations') + 1] ?? process.argv[process.argv.indexOf('-n') + 1]}"`);
        process.exit(2);
      }
    }

    if (scenarioPath!.includes('\0')) {
      console.error('\nError: Invalid path — null bytes are not allowed');
      process.exit(2);
    }
    if (opts.output && opts.output.includes('\0')) {
      console.error('\nError: Invalid output path — null bytes are not allowed');
      process.exit(2);
    }

    const resolvedPath = path.resolve(process.cwd(), scenarioPath!);

    try {
      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        console.error(`\nError: "${scenarioPath}" is a directory.`);
        console.error('Run a specific file: stepproof run ./scenarios/first-test.yaml');
        process.exit(2);
      }
    } catch (statErr) {
      if ((statErr as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error(`\nError: Scenario not found: ${resolvedPath}`);
        console.error("Run 'stepproof init' to scaffold a new scenario, or check the path.");
        process.exit(2);
      }
      // Other stat errors — let parseScenario surface the message
    }

    let scenario;
    try {
      scenario = parseScenario(resolvedPath);
    } catch (e) {
      console.error(`\nError parsing scenario: ${(e as Error).message}`);
      process.exit(2);
    }

    if (!isQuiet) {
      console.log(`\nLoading: ${scenario.name}`);
      if (opts.iterations) {
        console.log(`Overriding iterations: ${scenario.iterations ?? 10} → ${opts.iterations}`);
      }
    }

    // Load dataset if provided
    let dataset: Array<Record<string, string>> | undefined;
    if (opts.dataset) {
      const datasetPath = path.resolve(process.cwd(), opts.dataset);
      try {
        dataset = loadDataset(datasetPath);
        if (!isQuiet) {
          console.log(`Dataset: ${opts.dataset} (${dataset.length} rows)`);
        }
      } catch (e) {
        console.error(`\nError loading dataset: ${(e as Error).message}`);
        process.exit(2);
      }
    }

    let currentIteration = 0;
    const totalIterations = opts.iterations ?? scenario.iterations ?? 10;

    const runOptions: import('./core/scenario-runner.js').RunOptions = {
      iterations: opts.iterations,
      noCache: !opts.cache,
      cacheStats: undefined,
      dataset,
      datasetPath: opts.dataset,
      onIterationComplete: (iteration: number, total: number) => {
        currentIteration = iteration;
        if (!isQuiet) {
          process.stdout.write(`\r  Completed iteration ${iteration}/${total}...`);
          if (iteration === total) {
            process.stdout.write('\r' + ' '.repeat(50) + '\r');
          }
        }
      },
    };

    let report;
    try {
      report = await runScenario(scenario, resolvedPath, runOptions);
    } catch (e) {
      console.error(`\nError running scenario: ${(e as Error).message}`);
      await sendTelemetry({ command: 'run', success: false, version: CLI_VERSION, outcome: 'error', exit_code: 2, duration_ms: Date.now() - startMs, is_pro: isPro });
      process.exit(2);
    }

    // Baseline comparison
    let baselineComparison;
    let hasRegression = false;
    if (opts.baseline) {
      const baseline = loadBaseline(scenario.name);
      if (baseline) {
        baselineComparison = compareWithBaseline(report, baseline);
        hasRegression = baselineComparison.hasRegression;
      }
      // Save current run as the new baseline (including scenario YAML for diff)
      saveBaseline(scenario.name, report, scenarioYaml);
    }

    // Handle --format sarif / --format junit / --format github
    if (opts.format === 'sarif' || opts.format === 'junit') {
      const formatted = opts.format === 'sarif' ? formatSarif(report) : formatJunit(report);
      const hasExplicitOutput = process.argv.includes('--output') || process.argv.includes('-o');
      if (hasExplicitOutput) {
        try {
          fs.writeFileSync(opts.output, formatted, 'utf-8');
        } catch (e) {
          console.error(`Warning: Could not write ${opts.format} report: ${(e as Error).message}`);
        }
      } else {
        process.stdout.write(formatted + '\n');
      }
    }

    if (opts.format === 'github') {
      const markdown = formatPRComment(report, baselineComparison);
      const hasExplicitOutput = process.argv.includes('--output') || process.argv.includes('-o');
      if (hasExplicitOutput) {
        try {
          fs.writeFileSync(opts.output, markdown, 'utf-8');
        } catch (e) {
          console.error(`Warning: Could not write GitHub comment: ${(e as Error).message}`);
        }
      } else {
        process.stdout.write(markdown + '\n');
      }
    }

    const reportPath = opts.json ? opts.output : undefined;

    if (!isQuiet) {
      printReport(report, {
        reportPath,
        baselineComparison,
        cacheStats: runOptions.cacheStats,
      });
    }

    if (opts.json) {
      try {
        writeJsonReport(report, opts.output);
      } catch (e) {
        console.error(`Warning: Could not write JSON report: ${(e as Error).message}`);
      }
    }

    // Save report to .stepproof/results/ for view/history commands
    try {
      const savedPath = saveReport(report);
      if (!isQuiet) {
        console.log(chalk.dim(`Results saved to: ${savedPath}`));
        console.log(chalk.dim('Run `stepproof view` to open in browser'));
      }
    } catch { /* degrade gracefully */ }

    // Track usage after successful run completion
    await trackUsageAfterRun();

    // Exit 1 if regression detected
    if (hasRegression) {
      await sendTelemetry({ command: 'run', success: false, version: CLI_VERSION, outcome: 'regression', exit_code: 1, duration_ms: Date.now() - startMs, is_pro: isPro });
      process.exit(1);
    }

    // Exit 1 if any step below threshold — this is the CI gate
    if (!report.allPassed) {
      await sendTelemetry({ command: 'run', success: false, version: CLI_VERSION, outcome: 'fail', exit_code: 1, duration_ms: Date.now() - startMs, is_pro: isPro });
      process.exit(1);
    }

    await sendTelemetry({ command: 'run', success: true, version: CLI_VERSION, outcome: 'pass', exit_code: 0, duration_ms: Date.now() - startMs, is_pro: isPro });
    process.exit(0);
  });

/* ── Watch command ────────────────────────────────────────────────── */

program
  .command('watch <scenario>')
  .description('Watch a scenario file and re-run on changes')
  .option('-n, --iterations <number>', 'Number of iterations to run', parseInt)
  .option('--no-cache', 'Disable LLM response caching')
  .option('--dataset <path>', 'CSV file with input rows — run scenario once per row')
  .action(async (scenarioPath: string, opts: {
    iterations?: number;
    cache: boolean;
    dataset?: string;
  }) => {
    await sendTelemetry({ command: 'watch', success: true, version: CLI_VERSION, outcome: 'started' });
    startWatch(scenarioPath, {
      iterations: opts.iterations,
      noCache: !opts.cache,
      dataset: opts.dataset,
    });
  });

/* ── Baseline subcommands ──────────────────────────────────────────── */

const baselineCmd = program
  .command('baseline')
  .description('Manage baseline snapshots for regression detection');

baselineCmd
  .command('show [scenario]')
  .description('Show current baselines (all or for a specific scenario)')
  .action(async (scenarioName?: string) => {
    const baselines = listBaselines();
    if (baselines.length === 0) {
      console.log('\nNo baselines saved yet. Run `stepproof run` to create one.\n');
      process.exit(0);
    }

    const filtered = scenarioName
      ? baselines.filter(b => b.scenarioName.toLowerCase().includes(scenarioName.toLowerCase()))
      : baselines;

    if (filtered.length === 0) {
      console.log(`\nNo baseline found for "${scenarioName}"\n`);
      process.exit(0);
    }

    console.log('');
    console.log(chalk.bold('Baselines'));
    console.log(chalk.dim('─'.repeat(50)));
    for (const b of filtered) {
      console.log(`  ${chalk.bold(b.scenarioName)}`);
      for (const step of b.report.steps) {
        const pct = (step.passRate * 100).toFixed(1);
        console.log(`    ${step.stepId}: ${pct}% (${step.passes}/${step.totalRuns})`);
      }
      console.log(chalk.dim(`    Recorded: ${b.report.completedAt}`));
      console.log('');
    }
    await sendTelemetry({ command: 'baseline_show', success: true, version: CLI_VERSION, outcome: 'listed' });
  });

baselineCmd
  .command('reset [scenario]')
  .description('Clear baselines (all or for a specific scenario)')
  .action(async (scenarioName?: string) => {
    resetBaseline(scenarioName);
    if (scenarioName) {
      console.log(`\nBaseline cleared for "${scenarioName}"\n`);
    } else {
      console.log('\nAll baselines cleared\n');
    }
    await sendTelemetry({ command: 'baseline_reset', success: true, version: CLI_VERSION, outcome: 'cleared' });
  });

/* ── Cache subcommands ────────────────────────────────────────────── */

const cacheCmd = program
  .command('cache')
  .description('Manage LLM response cache');

cacheCmd
  .command('clear')
  .description('Delete all cached LLM responses')
  .action(async () => {
    const count = clearCache();
    console.log(`\nCleared ${count} cached response${count === 1 ? '' : 's'}\n`);
    await sendTelemetry({ command: 'cache_clear', success: true, version: CLI_VERSION, outcome: 'cleared' });
  });

/* ── Compare command ──────────────────────────────────────────────── */

program
  .command('compare <scenario>')
  .description('Run a scenario against multiple providers and compare results')
  .requiredOption('--providers <list>', 'Comma-separated provider:model pairs (e.g. anthropic:claude-sonnet-4-6,openai:gpt-4o)')
  .option('-n, --iterations <number>', 'Number of iterations per provider', parseInt)
  .option('--quiet', 'Suppress progress output')
  .action(async (scenarioPath: string, opts: {
    providers: string;
    iterations?: number;
    quiet: boolean;
  }) => {
    const isPro = isProUser();
    const startMs = Date.now();

    if (!checkUsageLimit()) {
      await sendTelemetry({ command: 'compare', success: false, version: CLI_VERSION, outcome: 'rate_limited', exit_code: 1, duration_ms: Date.now() - startMs, is_pro: isPro });
      process.exit(1);
    }

    let providerSpecs;
    try {
      providerSpecs = parseProviderSpecs(opts.providers);
    } catch (e) {
      console.error(`\nError: ${(e as Error).message}\n`);
      process.exit(2);
    }

    if (providerSpecs.length < 2) {
      console.error('\nError: --providers must specify at least 2 provider:model pairs\n');
      process.exit(2);
    }

    const resolvedPath = path.resolve(process.cwd(), scenarioPath);

    try {
      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        console.error(`\nError: "${scenarioPath}" is a directory. Specify a single scenario file.\n`);
        process.exit(2);
      }
    } catch (statErr) {
      if ((statErr as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error(`\nError: Scenario not found: ${resolvedPath}\n`);
        process.exit(2);
      }
    }

    let scenario;
    try {
      scenario = parseScenario(resolvedPath);
    } catch (e) {
      console.error(`\nError parsing scenario: ${(e as Error).message}`);
      process.exit(2);
    }

    const iterations = opts.iterations ?? scenario.iterations ?? 10;

    if (!opts.quiet) {
      console.log(`\nComparing ${providerSpecs.length} providers on: ${scenario.name}`);
      console.log(`Iterations per provider: ${iterations}\n`);
    }

    let comparisonReport;
    try {
      comparisonReport = await runComparison(scenario, resolvedPath, providerSpecs, iterations, {
        quiet: opts.quiet,
        onProviderStart: (provider, model) => {
          if (!opts.quiet) {
            console.log(`  Running ${provider}:${model}...`);
          }
        },
        onIterationComplete: (provider, iteration, total) => {
          if (!opts.quiet) {
            process.stdout.write(`\r    ${provider}: iteration ${iteration}/${total}...`);
            if (iteration === total) {
              process.stdout.write('\r' + ' '.repeat(60) + '\r');
            }
          }
        },
      });
    } catch (e) {
      console.error(`\nError running comparison: ${(e as Error).message}`);
      await sendTelemetry({ command: 'compare', success: false, version: CLI_VERSION, outcome: 'error', exit_code: 2, duration_ms: Date.now() - startMs, is_pro: isPro });
      process.exit(2);
    }

    console.log(formatComparison(comparisonReport));

    await trackUsageAfterRun();
    await sendTelemetry({ command: 'compare', success: true, version: CLI_VERSION, outcome: 'compared', exit_code: 0, duration_ms: Date.now() - startMs, is_pro: isPro });
    process.exit(0);
  });

/* ── Diff command ─────────────────────────────────────────────────── */

program
  .command('diff <scenario>')
  .description('Show what changed in a scenario since the last baseline')
  .action(async (scenarioPath: string) => {
    runDiff(scenarioPath);
    await sendTelemetry({ command: 'diff', success: true, version: CLI_VERSION, outcome: 'shown' });
  });

program.action(() => {
  const extra = process.argv.slice(2).filter(a => !a.startsWith('-'));
  if (extra.length > 0) {
    process.stderr.write(`\nError: Unknown command '${extra[0]}'\nRun 'stepproof --help' for usage.\n\n`);
    process.exit(2);
  }
  program.help(); // exits 0
});

// Override commander's default error handler for better UX
program.exitOverride((err) => {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
    process.exit(err.exitCode ?? 0);
  }
  if (err.code === 'commander.missingArgument') {
    const cmd = err.message.match(/'([^']+)'/)?.[1] ?? 'scenario';
    process.stderr.write(`\nError: Missing required argument <${cmd}>\n`);
    process.stderr.write(`Usage: stepproof run <scenario>\n`);
    process.stderr.write(`\nQuick start:\n  stepproof init            scaffold a starter scenario\n  stepproof run ./scenarios/first-test.yaml\n\n`);
    process.exit(2);
  }
  // All other commander errors: exit with the provided code
  process.exit(err.exitCode ?? 1);
});

program.parse(process.argv);
