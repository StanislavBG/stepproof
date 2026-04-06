import type { ScenarioReport, StepSummary } from '../core/types.js';
import type { BaselineComparison, StepComparison } from '../baseline.js';

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

function baselineCell(step: StepSummary, baselineMap: Map<string, StepComparison>): string {
  const cmp = baselineMap.get(step.stepId);
  if (!cmp) return '—';
  const deltaPct = (cmp.delta * 100).toFixed(1);
  if (cmp.delta > 0) return `↑ +${deltaPct}%`;
  if (cmp.delta < 0) return `↓ ${deltaPct}%`;
  return '→ same';
}

function statusEmoji(belowThreshold: boolean): string {
  return belowThreshold ? '❌ Fail' : '✅ Pass';
}

/**
 * Format a ScenarioReport as a GitHub PR comment in markdown.
 * Includes a marker comment so the action can update existing comments.
 */
export function formatPRComment(
  report: ScenarioReport,
  baselineComparison?: BaselineComparison,
): string {
  const baselineMap = new Map<string, StepComparison>();
  if (baselineComparison) {
    for (const s of baselineComparison.steps) {
      baselineMap.set(s.stepId, s);
    }
  }

  const hasBaseline = baselineMap.size > 0;
  const totalCost = report.steps.reduce((sum, s) => sum + s.totalCostUsd, 0);

  const lines: string[] = [];

  // Marker for upsert
  lines.push('<!-- stepproof-results -->');
  lines.push(`## Stepproof Results: ${report.scenarioName}`);
  lines.push('');

  // Table header
  if (hasBaseline) {
    lines.push('| Step | Pass Rate | Threshold | Status | Baseline |');
    lines.push('|------|-----------|-----------|--------|----------|');
  } else {
    lines.push('| Step | Pass Rate | Threshold | Status |');
    lines.push('|------|-----------|-----------|--------|');
  }

  // Table rows
  for (const step of report.steps) {
    const pct = (step.passRate * 100).toFixed(1);
    const threshold = (step.minPassRate * 100).toFixed(0);
    const passRateCell = `${pct}% (${step.passes}/${step.totalRuns})`;
    const status = statusEmoji(step.belowThreshold);

    if (hasBaseline) {
      const bl = baselineCell(step, baselineMap);
      lines.push(`| ${step.stepId} | ${passRateCell} | ${threshold}% | ${status} | ${bl} |`);
    } else {
      lines.push(`| ${step.stepId} | ${passRateCell} | ${threshold}% | ${status} |`);
    }
  }

  lines.push('');

  // Summary line
  const overallStatus = report.allPassed ? '✅ All steps passed' : '❌ Some steps failed';
  const costStr = totalCost > 0 ? ` | 💰 ${formatCost(totalCost)}` : '';
  lines.push(`**Overall: ${overallStatus}** | ⏱ ${formatDuration(report.durationMs)}${costStr}`);

  // Regression warning
  if (baselineComparison?.hasRegression) {
    const regSteps = baselineComparison.steps.filter(s => s.regression);
    lines.push('');
    lines.push(`> ⚠️ **Regression detected** in ${regSteps.map(s => `\`${s.stepId}\``).join(', ')}`);
  }

  // Iteration details in collapsible section
  if (report.results.length > 0) {
    lines.push('');
    lines.push('<details><summary>View iteration details</summary>');
    lines.push('');

    // Group results by step
    const byStep = new Map<string, typeof report.results>();
    for (const r of report.results) {
      const arr = byStep.get(r.stepId) ?? [];
      arr.push(r);
      byStep.set(r.stepId, arr);
    }

    for (const [stepId, results] of byStep) {
      lines.push(`### ${stepId}`);
      lines.push('');
      lines.push('| Iteration | Passed | Duration | Assertions |');
      lines.push('|-----------|--------|----------|------------|');
      for (const r of results) {
        const passIcon = r.passed ? '✅' : '❌';
        const dur = `${(r.durationMs / 1000).toFixed(1)}s`;
        const assertions = r.assertionResults
          .map(a => `${a.passed ? '✅' : '❌'} ${a.type}`)
          .join(', ');
        lines.push(`| ${r.iteration} | ${passIcon} | ${dur} | ${assertions} |`);
      }
      lines.push('');
    }

    lines.push('</details>');
  }

  return lines.join('\n');
}
