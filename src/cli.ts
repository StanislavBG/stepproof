#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseScenario } from './core/scenario-parser.js';
import { runScenario } from './core/scenario-runner.js';
import { writeJsonReport } from './reporters/json-reporter.js';
import { printReport, printProgress } from './reporters/terminal-reporter.js';
import { formatSarif } from './reporters/sarif-reporter.js';
import { formatJunit } from './reporters/junit-reporter.js';
import * as fs from 'node:fs';
import { guard, validate } from '@bilkobibitkov/preflight-license';
import { runInit } from './commands/init.js';
import { sendTelemetry } from './telemetry.js';

const CLI_VERSION = '0.2.20';

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
      `  Upgrade to Stepproof Pro for unlimited daily checks: ${UPGRADE_URL}\n` +
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
      `  Upgrade to Pro for unlimited runs: ${UPGRADE_URL}\n` +
      `  Already have a key? stepproof activate <key>\n\n`
    );
    await sendTelemetry({ command: 'cta_shown', success: true, version: CLI_VERSION, outcome: 'cta_shown', exit_code: 0, is_pro: false });
  } else if (remaining <= 10) {
    const runWord = remaining === 1 ? 'run' : 'runs';
    process.stderr.write(
      `\n  ${used}/${FREE_MONTHLY_LIMIT} free runs used this month — ${remaining} ${runWord} left.\n` +
      `  Unlock unlimited runs for $19/mo → ${UPGRADE_URL}\n` +
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
  .version('0.2.19')
  .addHelpText('after', `
Examples:
  stepproof init                                        scaffold a starter scenario
  stepproof run ./scenarios/first-test.yaml             run one scenario
  stepproof run ./scenarios/                            run all scenarios in a directory
  stepproof run test.yaml --format sarif --output results.sarif  SARIF output for CI`);

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
  .command('run [scenario]')
  .description('Run a scenario YAML file and report pass rates per step')
  .option('-n, --iterations <number>', 'Number of iterations to run (overrides scenario file)', parseInt)
  .option('-o, --output <file>', 'Path for output file (JSON by default; SARIF or JUnit when --format is set)', 'stepproof-report.json')
  .option('--no-json', 'Skip JSON report output')
  .option('--quiet', 'Suppress terminal output (use with --output for CI)')
  .option('--format <format>', 'Output format: sarif, junit')
  .option('--report <format>', '(deprecated: use --format)')
  .action(async (scenarioPath: string | undefined, opts: {
    iterations?: number;
    output: string;
    json: boolean;
    quiet: boolean;
    format?: string;
    report?: string;
  }) => {
    // --report is deprecated; normalize to --format
    if (opts.report && !opts.format) {
      process.stderr.write('Warning: --report is deprecated, use --format instead\n');
      opts.format = opts.report;
    }

    if (opts.format && opts.format !== 'sarif' && opts.format !== 'junit') {
      console.error(`\nError: --format must be "sarif" or "junit", got "${opts.format}"`);
      process.exit(2);
    }

    // License gate — check before running the scenario (avoid wasted API calls)
    if (opts.format === 'sarif' || opts.format === 'junit') {
      guard('team', { feature: `--format ${opts.format}` });
    }

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

    let currentIteration = 0;
    const totalIterations = opts.iterations ?? scenario.iterations ?? 10;

    let report;
    try {
      report = await runScenario(scenario, resolvedPath, {
        iterations: opts.iterations,
        onIterationComplete: (iteration, total) => {
          currentIteration = iteration;
          if (!isQuiet) {
            process.stdout.write(`\r  Completed iteration ${iteration}/${total}...`);
            if (iteration === total) {
              process.stdout.write('\r' + ' '.repeat(50) + '\r');
            }
          }
        },
      });
    } catch (e) {
      console.error(`\nError running scenario: ${(e as Error).message}`);
      await sendTelemetry({ command: 'run', success: false, version: CLI_VERSION, outcome: 'error', exit_code: 2, duration_ms: Date.now() - startMs, is_pro: isPro });
      process.exit(2);
    }

    // Handle --format sarif / --format junit
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

    const reportPath = opts.json ? opts.output : undefined;

    if (!isQuiet) {
      printReport(report, reportPath);
    }

    if (opts.json) {
      try {
        writeJsonReport(report, opts.output);
      } catch (e) {
        console.error(`Warning: Could not write JSON report: ${(e as Error).message}`);
      }
    }

    // Track usage after successful run completion
    await trackUsageAfterRun();

    // Exit 1 if any step below threshold — this is the CI gate
    if (!report.allPassed) {
      await sendTelemetry({ command: 'run', success: false, version: CLI_VERSION, outcome: 'fail', exit_code: 1, duration_ms: Date.now() - startMs, is_pro: isPro });
      process.exit(1);
    }

    await sendTelemetry({ command: 'run', success: true, version: CLI_VERSION, outcome: 'pass', exit_code: 0, duration_ms: Date.now() - startMs, is_pro: isPro });
    process.exit(0);
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
