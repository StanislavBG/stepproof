import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { parseScenario } from '../core/scenario-parser.js';
import { runScenario, type RunOptions } from '../core/scenario-runner.js';
import { printReport } from '../reporters/terminal-reporter.js';
import { loadDataset } from '../dataset.js';

export interface WatchOptions {
  iterations?: number;
  noCache?: boolean;
  dataset?: string;
}

export function startWatch(scenarioPath: string, opts: WatchOptions): void {
  const resolvedPath = path.resolve(process.cwd(), scenarioPath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`\nError: Scenario not found: ${resolvedPath}\n`);
    process.exit(2);
  }

  let running = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function executeRun(): Promise<void> {
    if (running) return;
    running = true;

    // Clear terminal
    process.stdout.write('\x1Bc');
    console.log(chalk.dim(`Watching ${path.basename(resolvedPath)}... (press Ctrl+C to stop)\n`));

    try {
      const scenario = parseScenario(resolvedPath);

      let dataset: Array<Record<string, string>> | undefined;
      if (opts.dataset) {
        const datasetPath = path.resolve(process.cwd(), opts.dataset);
        dataset = loadDataset(datasetPath);
      }

      const iterations = opts.iterations ?? scenario.iterations ?? 10;

      const runOptions: RunOptions = {
        iterations: opts.iterations,
        noCache: opts.noCache,
        dataset,
        datasetPath: opts.dataset,
        onIterationComplete: (iteration: number, total: number) => {
          process.stdout.write(`\r  Completed iteration ${iteration}/${total}...`);
          if (iteration === total) {
            process.stdout.write('\r' + ' '.repeat(50) + '\r');
          }
        },
      };

      const report = await runScenario(scenario, resolvedPath, runOptions);
      printReport(report, { cacheStats: runOptions.cacheStats });
    } catch (e) {
      console.error(chalk.red(`\nError: ${(e as Error).message}\n`));
    }

    running = false;
    console.log(chalk.dim(`\nWaiting for changes to ${path.basename(resolvedPath)}...`));
  }

  function onFileChange(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void executeRun();
    }, 500);
  }

  // Initial run
  void executeRun();

  // Watch the scenario file
  try {
    fs.watch(resolvedPath, { persistent: true }, (_eventType) => {
      onFileChange();
    });
  } catch (e) {
    console.error(chalk.red(`\nError watching file: ${(e as Error).message}\n`));
    process.exit(2);
  }

  // Also watch the dataset file if provided
  if (opts.dataset) {
    const datasetResolved = path.resolve(process.cwd(), opts.dataset);
    try {
      fs.watch(datasetResolved, { persistent: true }, (_eventType) => {
        onFileChange();
      });
    } catch {
      // Dataset file watch is best-effort
    }
  }
}
