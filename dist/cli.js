#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseScenario } from './core/scenario-parser.js';
import { runScenario } from './core/scenario-runner.js';
import { writeJsonReport } from './reporters/json-reporter.js';
import { printReport } from './reporters/terminal-reporter.js';
import { formatSarif } from './reporters/sarif-reporter.js';
import { formatJunit } from './reporters/junit-reporter.js';
import * as fs from 'node:fs';
import { guard, validate } from '@bilkobibitkov/preflight-license';
import { runInit } from './commands/init.js';
import { sendTelemetry } from './telemetry.js';
const CLI_VERSION = '0.2.8';
/* ── Usage-based monetization ───────────────────────────────────────── */
const FREE_MONTHLY_LIMIT = 10;
const UPGRADE_URL = 'https://buy.stripe.com/3cIbJ3fA8am122VcwE8k804';
const CONFIG_DIR = path.join(os.homedir(), '.config', 'stepproof');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const USAGE_FILE = path.join(CONFIG_DIR, 'usage.json');
/** Read license key from STEPPROOF_KEY env var or ~/.config/stepproof/config.json */
function getStepproofKey() {
    const envKey = process.env.STEPPROOF_KEY;
    if (envKey && envKey.trim())
        return envKey.trim();
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.key && parsed.key.trim())
                return parsed.key.trim();
        }
    }
    catch {
        // Corrupted config — ignore
    }
    return undefined;
}
/** Check if user has a valid pro license */
function isProUser() {
    const key = getStepproofKey();
    if (!key)
        return false;
    const result = validate(key);
    return result.valid && result.tier !== 'free';
}
/** Read current month's usage */
function readUsage() {
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    try {
        if (fs.existsSync(USAGE_FILE)) {
            const raw = fs.readFileSync(USAGE_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.month === currentMonth)
                return parsed;
        }
    }
    catch {
        // Corrupted — reset
    }
    return { month: currentMonth, count: 0 };
}
/** Write usage record to disk */
function writeUsage(record) {
    try {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(USAGE_FILE, JSON.stringify(record), 'utf8');
    }
    catch {
        // Can't write — degrade gracefully
    }
}
/** Check free limit before a run. Returns true if allowed, false if blocked. */
function checkUsageLimit() {
    if (isProUser())
        return true;
    const usage = readUsage();
    if (usage.count >= FREE_MONTHLY_LIMIT) {
        process.stderr.write(`\n─────────────────────────────────────────────────────────────\n` +
            `  ✗  ${FREE_MONTHLY_LIMIT}/${FREE_MONTHLY_LIMIT} free runs used this month — this run didn't execute.\n\n` +
            `  Stepproof Pro unblocks your workflow:\n` +
            `  ├── Unlimited runs         — no monthly cap, ever\n` +
            `  ├── CI integration         — run on every PR with exit 1 on failure\n` +
            `  ├── SARIF/JUnit output     — native GitHub Security tab integration\n` +
            `  ├── PDF reports            — shareable test run summaries\n` +
            `  └── Full run history       — see if pass rates are improving over time\n\n` +
            `  $19/mo, cancel anytime\n` +
            `  → Upgrade: ${UPGRADE_URL}\n` +
            `    Already have a key? stepproof activate <key>\n` +
            `─────────────────────────────────────────────────────────────\n\n`);
        return false;
    }
    return true;
}
/** Increment usage after a successful free run and show a state-based CTA */
function trackUsageAfterRun() {
    if (isProUser())
        return;
    const usage = readUsage();
    usage.count += 1;
    writeUsage(usage);
    const used = usage.count;
    const remaining = FREE_MONTHLY_LIMIT - used;
    let msg;
    if (remaining === 1) {
        // Nudge C — urgency (run 9 of 10)
        msg =
            `\n─────────────────────────────────────────────────────────────\n` +
                `  ${used} of ${FREE_MONTHLY_LIMIT} free runs used — 1 left this month.\n\n` +
                `  Don't hit the cap mid-sprint. Pro removes the limit and\n` +
                `  adds CI integration so stepproof runs on every commit.\n` +
                `  $19/mo → ${UPGRADE_URL}\n` +
                `─────────────────────────────────────────────────────────────\n`;
    }
    else if (remaining <= 5) {
        // Nudge B — feature angle (runs 5–8)
        msg =
            `\n─────────────────────────────────────────────────────────────\n` +
                `  ${used} of ${FREE_MONTHLY_LIMIT} free runs used this month.\n` +
                `  You're running stepproof regularly — that's when CI integration\n` +
                `  starts paying off. Pro runs it automatically on every PR.\n` +
                `  $19/mo · Upgrade: ${UPGRADE_URL}\n` +
                `─────────────────────────────────────────────────────────────\n`;
    }
    else {
        // Nudge A — lightweight (runs 1–4)
        msg =
            `\n─────────────────────────────────────────────────────────────\n` +
                `  Run ${used} of ${FREE_MONTHLY_LIMIT} free this month.\n` +
                `  Pro adds CI integration, SARIF output, and run history.\n` +
                `  stepproof activate <key>  ·  Upgrade → ${UPGRADE_URL}\n` +
                `─────────────────────────────────────────────────────────────\n`;
    }
    process.stderr.write(msg);
}
/* ── CLI ────────────────────────────────────────────────────────────── */
const program = new Command();
program
    .name('stepproof')
    .description('Regression testing for multi-step AI workflows. Not observability — a CI gate.')
    .version('0.2.8')
    .addHelpText('after', `
Examples:
  stepproof init                                        scaffold a starter scenario
  stepproof run ./scenarios/first-test.yaml             run one scenario
  stepproof run ./scenarios/                            run all scenarios in a directory
  stepproof run test.yaml --format sarif --output results.sarif  SARIF output for CI`);
program
    .command('init [dir]')
    .description('Scaffold a starter scenario in ./scenarios/first-test.yaml')
    .action((dir) => {
    runInit(dir);
});
program
    .command('activate <key>')
    .description('Store a license key for unlimited runs')
    .action((key) => {
    const result = validate(key);
    if (!result.valid) {
        process.stderr.write(`\nInvalid license key: ${result.reason}\n\n`);
        process.exit(1);
    }
    try {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ key }), 'utf8');
        console.log(`\nLicense activated (${result.tier} — ${result.org}). Unlimited runs enabled.\n`);
    }
    catch (e) {
        process.stderr.write(`\nFailed to save license: ${e.message}\n\n`);
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
    .action(async (scenarioPath, opts) => {
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
    if (scenarioPath.includes('\0')) {
        console.error('\nError: Invalid path — null bytes are not allowed');
        process.exit(2);
    }
    if (opts.output && opts.output.includes('\0')) {
        console.error('\nError: Invalid output path — null bytes are not allowed');
        process.exit(2);
    }
    const resolvedPath = path.resolve(process.cwd(), scenarioPath);
    try {
        const stat = fs.statSync(resolvedPath);
        if (stat.isDirectory()) {
            console.error(`\nError: "${scenarioPath}" is a directory.`);
            console.error('Run a specific file: stepproof run ./scenarios/first-test.yaml');
            process.exit(2);
        }
    }
    catch (statErr) {
        if (statErr.code === 'ENOENT') {
            console.error(`\nError: Scenario not found: ${resolvedPath}`);
            console.error("Run 'stepproof init' to scaffold a new scenario, or check the path.");
            process.exit(2);
        }
        // Other stat errors — let parseScenario surface the message
    }
    let scenario;
    try {
        scenario = parseScenario(resolvedPath);
    }
    catch (e) {
        console.error(`\nError parsing scenario: ${e.message}`);
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
    }
    catch (e) {
        console.error(`\nError running scenario: ${e.message}`);
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
            }
            catch (e) {
                console.error(`Warning: Could not write ${opts.format} report: ${e.message}`);
            }
        }
        else {
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
        }
        catch (e) {
            console.error(`Warning: Could not write JSON report: ${e.message}`);
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
//# sourceMappingURL=cli.js.map