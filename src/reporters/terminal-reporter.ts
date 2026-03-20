import chalk from 'chalk';
import type { ScenarioReport, StepSummary } from '../core/types.js';

export function printReport(report: ScenarioReport, reportPath?: string): void {
  const { scenarioName, iterations, steps, allPassed, durationMs } = report;

  console.log('');
  console.log(chalk.bold('stepproof') + chalk.dim(' v0.1.0'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`${chalk.bold('Scenario:')} ${scenarioName}`);
  console.log(`${chalk.bold('Iterations:')} ${iterations}`);
  console.log(`${chalk.bold('Duration:')} ${formatDuration(durationMs)}`);
  console.log('');

  for (const step of steps) {
    printStepSummary(step, iterations);
  }

  console.log(chalk.dim('─'.repeat(50)));
  printSummaryLine(allPassed, steps);

  if (reportPath) {
    console.log('');
    console.log(chalk.dim(`Report written to: ${reportPath}`));
  }

  console.log('');
}

function printStepSummary(step: StepSummary, iterations: number): void {
  const { stepId, passes, totalRuns, passRate, minPassRate, belowThreshold, failures } = step;

  const statusIcon = belowThreshold ? chalk.red('✗') : chalk.green('✓');
  const rateColor = belowThreshold ? chalk.red : chalk.green;
  const pct = (passRate * 100).toFixed(1);
  const threshold = (minPassRate * 100).toFixed(0);

  console.log(`  ${statusIcon} ${chalk.bold(stepId)}`);
  console.log(`    ${renderBar(passes, totalRuns)} ${passes}/${totalRuns} iterations`);
  console.log(
    `    Pass rate: ${rateColor(`${pct}%`)}  ${chalk.dim(`(threshold: ${threshold}%)`)}`
  );

  if (belowThreshold) {
    console.log(`    ${chalk.red(`✗ BELOW THRESHOLD — ${failures} failure${failures === 1 ? '' : 's'}`)}`);
  }

  console.log('');
}

function renderBar(passes: number, total: number): string {
  const barWidth = 20;
  const filled = Math.round((passes / total) * barWidth);
  const empty = barWidth - filled;
  const bar = chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
  return `[${bar}]`;
}

function printSummaryLine(allPassed: boolean, steps: StepSummary[]): void {
  const failing = steps.filter((s) => s.belowThreshold);

  if (allPassed) {
    console.log(chalk.bold.green('PASSED') + chalk.dim(' — all steps above threshold'));
  } else {
    const stepList = failing.map((s) => chalk.red(s.stepId)).join(', ');
    console.log(
      chalk.bold.red('FAILED') +
      chalk.dim(` — ${failing.length} step${failing.length === 1 ? '' : 's'} below threshold: `) +
      stepList
    );
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

export function printProgress(stepId: string, iteration: number, total: number): void {
  process.stdout.write(`\r  ${chalk.dim('Running')} ${stepId} — iteration ${iteration}/${total}...`);
  if (iteration === total) {
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
  }
}
