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

const CLI_VERSION = '0.2.7';

/* ── Usage-based monetization ───────────────────────────────────────── */

const FREE_MONTHLY_LIMIT = 10;
const UPGRADE_URL = 'https://buy.stripe.com/3cIbJ3fA8am122VcwE8k804';
const CONFIG_DIR = path.join(os.homedir(), '.config', 'stepproof');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const USAGE_FILE = path.join(CONFIG_DIR, 'usage.json');

interface UsageRecord {
  month: string;  // YYYY-MM
  count: number;
}

/** Read license key from STEPPROOF_KEY env var or ~/.config/stepproof/config.json */
function getStepproofKey(): string | undefined {
  const envKey = process.env.STEPPROOF_KEY;
  if (envKey && envKey.trim()) return envKey.trim();

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw) as { key?: string };
      if (parsed.key && parsed.key.trim()) return parsed.key.trim();
    }
  } catch {
    // Corrupted config — ignore
  }
  return undefined;
}

/** Check if user has a valid pro license */
function isProUser(): boolean {
  const key = getStepproofKey();
  if (!key) return false;
  const result = validate(key);
  return result.valid && result.tier !== 'free';
}

/** Read current month's usage */
function readUsage(): UsageRecord {
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  try {
    if (fs.existsSync(USAGE_FILE)) {
      const raw = fs.readFileSync(USAGE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as UsageRecord;
      if (parsed.month === currentMonth) return parsed;
    }
  } catch {
    // Corrupted — reset
  }
  return { month: currentMonth, count: 0 };
}

/** Write usage record to disk */
function writeUsage(record: UsageRecord): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(record), 'utf8');
  } catch {
    // Can't write — degrade gracefully
  }
}

/** Check free limit before a run. Returns true if allowed, false if blocked. */
function checkUsageLimit(): boolean {
  if (isProUser()) return true;

  const usage = readUsage();
  if (usage.count >= FREE_MONTHLY_LIMIT) {
    process.stderr.write(
      `\n─────────────────────────────────────────────────────────────\n` +
      `  You've used all ${FREE_MONTHLY_LIMIT} free runs this month.\n\n` +
      `  Stepproof Pro ($19/mo) unlocks:\n` +
      `    · Unlimited runs          · Test run dashboard\n` +
      `    · PDF reports             · Slack alerts\n` +
      `    · Full run history        · SARIF/JUnit CI output\n\n` +
      `  Upgrade → ${UPGRADE_URL}\n` +
      `─────────────────────────────────────────────────────────────\n\n`
    );
    return false;
  }
  return true;
}

/** Increment usage after a successful free run and show remaining count */
function trackUsageAfterRun(): void {
  if (isProUser()) return;

  const usage = readUsage();
  usage.count += 1;
  writeUsage(usage);

  const remaining = FREE_MONTHLY_LIMIT - usage.count;
  process.stderr.write(
    `\n─────────────────────────────────────────────────────────────\n` +
    `  ${remaining} of ${FREE_MONTHLY_LIMIT} free runs remaining this month.\n` +
    `  Pro unlocks: unlimited runs · PDF reports · Slack alerts · run history\n` +
    `  Upgrade → ${UPGRADE_URL}\n` +
    `─────────────────────────────────────────────────────────────\n`
  );
}

/* ── CLI ────────────────────────────────────────────────────────────── */

const program = new Command();

program
  .name('stepproof')
  .description('Regression testing for multi-step AI workflows. Not observability — a CI gate.')
  .version('0.2.7')
  .addHelpText('after', `
Examples:
  stepproof init                                        scaffold a starter scenario
  stepproof run ./scenarios/first-test.yaml             run one scenario
  stepproof run ./scenarios/                            run all scenarios in a directory
  stepproof run test.yaml --format sarif --output results.sarif  SARIF output for CI`);

program
  .command('init [dir]')
  .description('Scaffold a starter scenario in ./scenarios/first-test.yaml')
  .action((dir?: string) => {
    runInit(dir);
  });

program
  .command('activate <key>')
  .description('Store a license key for unlimited runs')
  .action((key: string) => {
    const result = validate(key);
    if (!result.valid) {
      process.stderr.write(`\nInvalid license key: ${result.reason}\n\n`);
      process.exit(1);
    }
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ key }), 'utf8');
      console.log(`\nLicense activated (${result.tier} — ${result.org}). Unlimited runs enabled.\n`);
    } catch (e) {
      process.stderr.write(`\nFailed to save license: ${(e as Error).message}\n\n`);
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

    // Usage limit — check before running (avoid wasted API calls)
    if (!checkUsageLimit()) {
      await sendTelemetry({ command: 'run', success: false, version: CLI_VERSION, outcome: 'rate_limited' });
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
      await sendTelemetry({ command: 'run', success: false, version: CLI_VERSION, outcome: 'error' });
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
    trackUsageAfterRun();

    // Exit 1 if any step below threshold — this is the CI gate
    if (!report.allPassed) {
      await sendTelemetry({ command: 'run', success: false, version: CLI_VERSION, outcome: 'fail' });
      process.exit(1);
    }

    await sendTelemetry({ command: 'run', success: true, version: CLI_VERSION, outcome: 'pass' });
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
