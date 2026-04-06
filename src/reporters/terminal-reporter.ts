import chalk from 'chalk';
import { createRequire } from 'node:module';
import type { ScenarioReport, StepSummary, StepResult } from '../core/types.js';
import type { BaselineComparison, StepComparison } from '../baseline.js';
import type { CacheStats } from '../core/scenario-runner.js';
import type { ComparisonReport } from '../commands/compare.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

export interface PrintReportOptions {
  reportPath?: string;
  baselineComparison?: BaselineComparison;
  cacheStats?: CacheStats;
}

export function printReport(report: ScenarioReport, reportPathOrOpts?: string | PrintReportOptions): void {
  const { scenarioName, iterations, steps, allPassed, durationMs } = report;

  // Normalize overloaded param
  const opts: PrintReportOptions = typeof reportPathOrOpts === 'string'
    ? { reportPath: reportPathOrOpts }
    : reportPathOrOpts ?? {};

  const baselineMap = new Map<string, StepComparison>();
  if (opts.baselineComparison) {
    for (const s of opts.baselineComparison.steps) {
      baselineMap.set(s.stepId, s);
    }
  }

  console.log('');
  console.log(chalk.bold('stepproof') + chalk.dim(` v${version}`));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`${chalk.bold('Scenario:')} ${scenarioName}`);
  console.log(`${chalk.bold('Iterations:')} ${iterations}`);
  console.log(`${chalk.bold('Duration:')} ${formatDuration(durationMs)}`);

  if (report.dataset) {
    console.log(`${chalk.bold('Dataset:')} ${report.dataset.path} (${report.dataset.totalRows} rows)`);
  }

  if (opts.cacheStats && (opts.cacheStats.hits > 0 || opts.cacheStats.misses > 0)) {
    console.log(`${chalk.bold('Cache:')} ${opts.cacheStats.hits} hits, ${opts.cacheStats.misses} misses`);
  }

  console.log('');

  // Dataset mode: show per-row results
  if (report.dataset) {
    for (const row of report.dataset.rowSummaries) {
      const previewParts = Object.entries(row.rowPreview)
        .map(([k, v]) => `${k}="${v.length > 30 ? v.slice(0, 30) + '...' : v}"`)
        .join(', ');
      console.log(chalk.bold(`  Row ${row.rowIndex + 1}`) + chalk.dim(` (${previewParts}):`));

      for (const sr of row.stepResults) {
        const icon = sr.passed ? chalk.green('✓') : chalk.red('✗');
        const pct = (sr.passRate * 100).toFixed(0);
        console.log(`    step: ${sr.stepId}  ${icon} ${pct}%`);
      }
    }

    console.log('');
    console.log(chalk.dim('─'.repeat(50)));
    const rowPassPct = ((report.dataset.rowsPassed / report.dataset.totalRows) * 100).toFixed(0);
    console.log(
      `${chalk.bold('Overall:')} ${report.dataset.rowsPassed}/${report.dataset.totalRows} rows passed all steps (${rowPassPct}%)`
    );
    console.log('');
  }

  // Aggregate step summaries (shown in both modes)
  for (const step of steps) {
    // Find stream metrics from the first result that has them
    const stepResults = report.results.filter(r => r.stepId === step.stepId);
    const streamMetrics = stepResults.find(r => r.streamMetrics)?.streamMetrics;
    printStepSummary(step, iterations, baselineMap.get(step.stepId), streamMetrics);
  }

  console.log(chalk.dim('─'.repeat(50)));
  printSummaryLine(allPassed, steps);

  if (opts.baselineComparison?.hasRegression) {
    const regSteps = opts.baselineComparison.steps.filter(s => s.regression);
    console.log(
      chalk.bold.yellow('REGRESSION DETECTED') +
      chalk.dim(` — ${regSteps.length} step${regSteps.length === 1 ? '' : 's'} dropped: `) +
      regSteps.map(s => chalk.yellow(s.stepId)).join(', ')
    );
  }

  if (opts.reportPath) {
    console.log('');
    console.log(chalk.dim(`Report written to: ${opts.reportPath}`));
  }

  console.log('');
}

function printStepSummary(
  step: StepSummary,
  iterations: number,
  baseline?: StepComparison,
  streamMetrics?: StepResult['streamMetrics'],
): void {
  const { stepId, passes, totalRuns, passRate, minPassRate, belowThreshold, failures } = step;

  const statusIcon = belowThreshold ? chalk.red('✗') : chalk.green('✓');
  const rateColor = belowThreshold ? chalk.red : chalk.green;
  const pct = (passRate * 100).toFixed(1);
  const threshold = (minPassRate * 100).toFixed(0);

  // Baseline delta indicator
  let baselineStr = '';
  if (baseline) {
    const bPct = (baseline.baselineRate * 100).toFixed(1);
    const deltaPct = (baseline.delta * 100).toFixed(1);
    if (baseline.delta > 0) {
      baselineStr = chalk.green(` ↑ +${deltaPct}%`) + chalk.dim(` (baseline: ${bPct}%)`);
    } else if (baseline.delta < 0) {
      baselineStr = chalk.red(` ↓ ${deltaPct}%`) + chalk.dim(` (baseline: ${bPct}%)`);
    } else {
      baselineStr = chalk.dim(` = (baseline: ${bPct}%)`);
    }
  }

  // Cost/latency metrics
  const avgSec = (step.avgDurationMs / 1000).toFixed(1);
  const avgCost = formatCost(step.avgCostUsd);
  const totalCost = formatCost(step.totalCostUsd);
  const hasCost = step.totalCostUsd > 0;

  // Stream metrics suffix
  const streamStr = streamMetrics
    ? `, TTFT ${streamMetrics.ttftMs.toFixed(0)}ms, ${streamMetrics.tokensPerSecond.toFixed(0)} tok/s`
    : '';

  const metricsSuffix = hasCost
    ? chalk.dim(` — avg ${avgSec}s, ${avgCost}/call, total ${totalCost}${streamStr}`)
    : chalk.dim(` — avg ${avgSec}s${streamStr}`);

  // Retry indicator
  const retryStr = step.retriedCount
    ? chalk.yellow(` — ${step.retriedCount} retried`)
    : '';

  console.log(`  ${statusIcon} ${chalk.bold(stepId)}${metricsSuffix}`);
  console.log(`    ${renderBar(passes, totalRuns)} ${passes}/${totalRuns} iterations${retryStr}`);
  console.log(
    `    Pass rate: ${rateColor(`${pct}%`)}  ${chalk.dim(`(threshold: ${threshold}%)`)}${baselineStr}`
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

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function printProgress(stepId: string, iteration: number, total: number): void {
  process.stdout.write(`\r  ${chalk.dim('Running')} ${stepId} — iteration ${iteration}/${total}...`);
  if (iteration === total) {
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
  }
}

export function formatComparison(report: ComparisonReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold('stepproof compare') + chalk.dim(` v${version}`));
  lines.push(chalk.dim('─'.repeat(60)));
  lines.push(`${chalk.bold('Scenario:')} ${report.scenarioName}`);
  lines.push(`${chalk.bold('Iterations:')} ${report.iterations}`);
  lines.push(`${chalk.bold('Duration:')} ${formatDuration(report.durationMs)}`);
  lines.push(`${chalk.bold('Providers:')} ${report.providers.map(p => `${p.provider}:${p.model}`).join(', ')}`);
  lines.push('');

  // Header row
  const providerLabels = report.providers.map(p => `${p.provider}:${p.model}`);
  const colWidth = Math.max(20, ...providerLabels.map(l => l.length + 2));
  const stepColWidth = Math.max(12, ...report.stepBreakdown.map(s => s.stepId.length + 2));

  const headerPad = ' '.repeat(stepColWidth);
  lines.push(`  ${headerPad}${providerLabels.map(l => l.padEnd(colWidth)).join('')}`);
  lines.push(`  ${chalk.dim('─'.repeat(stepColWidth + colWidth * providerLabels.length))}`);

  // Step rows
  for (const step of report.stepBreakdown) {
    const stepLabel = step.stepId.padEnd(stepColWidth);
    const cells = step.rates.map(r => {
      const pct = (r.passRate * 100).toFixed(1) + '%';
      const isBest = r.provider === step.bestProvider && r.model === step.bestModel;
      const display = `${r.passes}/${r.totalRuns} (${pct})`;
      const colored = isBest ? chalk.green(display) : display;
      return colored.padEnd(colWidth + (isBest ? colored.length - display.length : 0));
    });
    // padEnd doesn't work well with chalk, so we use a simpler approach
    const rawCells = step.rates.map(r => {
      const pct = (r.passRate * 100).toFixed(1) + '%';
      const isBest = r.provider === step.bestProvider && r.model === step.bestModel;
      const display = `${r.passes}/${r.totalRuns} (${pct})`;
      const padding = ' '.repeat(Math.max(0, colWidth - display.length));
      return (isBest ? chalk.green(display) : display) + padding;
    });
    lines.push(`  ${stepLabel}${rawCells.join('')}`);
  }

  lines.push('');
  lines.push(chalk.dim('─'.repeat(60)));

  // Overall averages
  const avgLines = report.providers.map(p => {
    const avg = p.report.steps.reduce((sum, s) => sum + s.passRate, 0) / p.report.steps.length;
    return { label: `${p.provider}:${p.model}`, avg };
  });
  for (const a of avgLines) {
    const isWinner = a.label === `${report.winner}:${report.winnerModel}`;
    const pct = (a.avg * 100).toFixed(1) + '%';
    const line = `  ${a.label}: ${pct}${isWinner ? ' ★' : ''}`;
    lines.push(isWinner ? chalk.bold.green(line) : line);
  }

  lines.push('');
  lines.push(chalk.bold('Winner: ') + chalk.green(`${report.winner}:${report.winnerModel}`));
  lines.push('');

  return lines.join('\n');
}
