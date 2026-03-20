#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'node:path';
import { parseScenario } from './core/scenario-parser.js';
import { runScenario } from './core/scenario-runner.js';
import { writeJsonReport } from './reporters/json-reporter.js';
import { printReport, printProgress } from './reporters/terminal-reporter.js';

const program = new Command();

program
  .name('stepproof')
  .description('Regression testing for multi-step AI workflows. Not observability — a CI gate.')
  .version('0.1.0');

program
  .command('run <scenario>')
  .description('Run a scenario YAML file and report pass rates per step')
  .option('-n, --iterations <number>', 'Number of iterations to run (overrides scenario file)', parseInt)
  .option('-o, --output <file>', 'Path for JSON report output', 'stepproof-report.json')
  .option('--no-json', 'Skip JSON report output')
  .option('--quiet', 'Suppress terminal output (use with --output for CI)')
  .action(async (scenarioPath: string, opts: {
    iterations?: number;
    output: string;
    json: boolean;
    quiet: boolean;
  }) => {
    const resolvedPath = path.resolve(process.cwd(), scenarioPath);

    let scenario;
    try {
      scenario = parseScenario(resolvedPath);
    } catch (e) {
      console.error(`\nError parsing scenario: ${(e as Error).message}`);
      process.exit(2);
    }

    if (!opts.quiet) {
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
          if (!opts.quiet) {
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

    const reportPath = opts.json ? opts.output : undefined;

    if (!opts.quiet) {
      printReport(report, reportPath);
    }

    if (opts.json) {
      try {
        writeJsonReport(report, opts.output);
        if (!opts.quiet) {
          // Already printed in printReport
        }
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
