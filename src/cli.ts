#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'node:path';
import { parseScenario } from './core/scenario-parser.js';
import { runScenario } from './core/scenario-runner.js';
import { writeJsonReport } from './reporters/json-reporter.js';
import { printReport, printProgress } from './reporters/terminal-reporter.js';
import { formatSarif } from './reporters/sarif-reporter.js';
import { formatJunit } from './reporters/junit-reporter.js';
import * as fs from 'node:fs';

const program = new Command();

program
  .name('stepproof')
  .description('Regression testing for multi-step AI workflows. Not observability — a CI gate.')
  .version('0.2.0');

program
  .command('run <scenario>')
  .description('Run a scenario YAML file and report pass rates per step')
  .option('-n, --iterations <number>', 'Number of iterations to run (overrides scenario file)', parseInt)
  .option('-o, --output <file>', 'Path for JSON report output', 'stepproof-report.json')
  .option('--no-json', 'Skip JSON report output')
  .option('--quiet', 'Suppress terminal output (use with --output for CI)')
  .option('--report <format>', 'Output format: sarif, junit')
  .action(async (scenarioPath: string, opts: {
    iterations?: number;
    output: string;
    json: boolean;
    quiet: boolean;
    report?: string;
  }) => {
    if (opts.report && opts.report !== 'sarif' && opts.report !== 'junit') {
      console.error(`\nError: --report must be "sarif" or "junit", got "${opts.report}"`);
      process.exit(2);
    }

    // --report implies quiet (suppress terminal output) unless --quiet already set
    const isQuiet = opts.quiet || !!opts.report;
    const resolvedPath = path.resolve(process.cwd(), scenarioPath);

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
      process.exit(2);
    }

    // Handle --report sarif / --report junit
    if (opts.report === 'sarif' || opts.report === 'junit') {
      const formatted = opts.report === 'sarif' ? formatSarif(report) : formatJunit(report);
      const hasExplicitOutput = process.argv.includes('--output') || process.argv.includes('-o');
      if (hasExplicitOutput) {
        try {
          fs.writeFileSync(opts.output, formatted, 'utf-8');
        } catch (e) {
          console.error(`Warning: Could not write ${opts.report} report: ${(e as Error).message}`);
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

    // Exit 1 if any step below threshold — this is the CI gate
    if (!report.allPassed) {
      process.exit(1);
    }

    process.exit(0);
  });

program.parse(process.argv);
