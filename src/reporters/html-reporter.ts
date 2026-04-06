import type { ScenarioReport, StepSummary, StepResult } from '../core/types.js';

export function generateHtmlReport(report: ScenarioReport): string {
  const reportJson = JSON.stringify(report);
  const passColor = '#22c55e';
  const failColor = '#ef4444';
  const verdictColor = report.allPassed ? passColor : failColor;
  const verdictText = report.allPassed ? 'PASSED' : 'FAILED';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Stepproof — ${escHtml(report.scenarioName)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; padding: 2rem; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }
  .meta { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }
  .meta span { margin-right: 1.5rem; }
  .verdict { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 4px; font-weight: 700; font-size: 0.875rem; background: ${verdictColor}20; color: ${verdictColor}; border: 1px solid ${verdictColor}40; margin-bottom: 1.5rem; }
  .card { background: #1e293b; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; border: 1px solid #334155; }
  .step-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; }
  .step-header:hover { opacity: 0.85; }
  .step-name { font-weight: 600; font-size: 1.05rem; }
  .step-icon { font-size: 1.1rem; margin-right: 0.5rem; }
  .step-rate { font-size: 0.875rem; color: #94a3b8; }
  .bar-container { background: #334155; border-radius: 4px; height: 8px; margin: 0.75rem 0; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s ease; }
  .bar-pass { background: ${passColor}; }
  .bar-fail { background: ${failColor}; }
  .step-stats { display: flex; gap: 1.5rem; font-size: 0.8rem; color: #94a3b8; }
  .iterations { display: none; margin-top: 1rem; border-top: 1px solid #334155; padding-top: 0.75rem; }
  .iterations.open { display: block; }
  .iter-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.4rem 0; font-size: 0.8rem; border-bottom: 1px solid #1e293b; }
  .iter-row:last-child { border-bottom: none; }
  .iter-badge { display: inline-block; width: 18px; height: 18px; border-radius: 50%; text-align: center; line-height: 18px; font-size: 0.65rem; font-weight: 700; color: #fff; flex-shrink: 0; }
  .iter-pass { background: ${passColor}; }
  .iter-fail { background: ${failColor}; }
  .iter-assertions { color: #94a3b8; flex: 1; }
  .iter-duration { color: #64748b; white-space: nowrap; }
  .iter-output { margin-top: 0.25rem; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.75rem; color: #cbd5e1; background: #0f172a; padding: 0.5rem; border-radius: 4px; max-height: 120px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; display: none; }
  .iter-output.open { display: block; }
  .iter-toggle { cursor: pointer; color: #60a5fa; font-size: 0.75rem; }
  .iter-toggle:hover { text-decoration: underline; }
  .assertion-line { font-size: 0.75rem; padding-left: 1.5rem; }
  .assertion-pass { color: ${passColor}; }
  .assertion-fail { color: ${failColor}; }
  .summary-bar { display: flex; gap: 1.5rem; margin-top: 1rem; font-size: 0.8rem; color: #94a3b8; }
  .chevron { transition: transform 0.2s; display: inline-block; }
  .chevron.open { transform: rotate(90deg); }
  @media (max-width: 640px) { body { padding: 1rem; } .step-stats { flex-wrap: wrap; gap: 0.75rem; } }
</style>
</head>
<body>

<h1>${escHtml(report.scenarioName)}</h1>
<div class="meta">
  <span>${new Date(report.startedAt).toLocaleString()}</span>
  <span>${formatDuration(report.durationMs)}</span>
  <span>${report.iterations} iteration${report.iterations === 1 ? '' : 's'}</span>
</div>
<div class="verdict">${verdictText}</div>

${report.steps.map((step, i) => renderStep(step, report.results.filter(r => r.stepId === step.stepId), i)).join('\n')}

<div class="summary-bar">
  <span>${report.steps.filter(s => !s.belowThreshold).length}/${report.steps.length} steps passed</span>
  <span>Total: ${formatDuration(report.durationMs)}</span>
</div>

<script>
const REPORT = ${reportJson};

function toggleIterations(idx) {
  const el = document.getElementById('iters-' + idx);
  const chev = document.getElementById('chev-' + idx);
  if (el) { el.classList.toggle('open'); }
  if (chev) { chev.classList.toggle('open'); }
}

function toggleOutput(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.toggle('open'); }
}
</script>
</body>
</html>`;
}

function renderStep(step: StepSummary, results: StepResult[], index: number): string {
  const pct = (step.passRate * 100).toFixed(1);
  const threshPct = (step.minPassRate * 100).toFixed(0);
  const icon = step.belowThreshold ? '&#10005;' : '&#10003;';
  const iconColor = step.belowThreshold ? '#ef4444' : '#22c55e';
  const barColor = step.belowThreshold ? 'bar-fail' : 'bar-pass';
  const avgDur = step.avgDurationMs ? formatDuration(step.avgDurationMs) : '';
  const costStr = step.totalCostUsd > 0 ? `$${step.totalCostUsd.toFixed(4)} total / $${step.avgCostUsd.toFixed(4)} avg` : '';

  const iterRows = results.map((r, i) => {
    const badge = r.passed ? 'iter-pass' : 'iter-fail';
    const sym = r.passed ? '&#10003;' : '&#10005;';
    const iterCost = r.costUsd != null && r.costUsd > 0 ? ` &middot; $${r.costUsd.toFixed(4)}` : '';
    const assertions = r.assertionResults.map(a => {
      const cls = a.passed ? 'assertion-pass' : 'assertion-fail';
      const asym = a.passed ? '&#10003;' : '&#10005;';
      return `<div class="assertion-line ${cls}">${asym} ${escHtml(a.type)}${a.message ? ': ' + escHtml(a.message) : ''}</div>`;
    }).join('');
    const outputId = `output-${index}-${i}`;
    return `<div>
      <div class="iter-row">
        <span class="iter-badge ${badge}">${sym}</span>
        <span>Iteration ${r.iteration}</span>
        <span class="iter-duration">${formatDuration(r.durationMs)}${iterCost}</span>
        <span class="iter-toggle" onclick="toggleOutput('${outputId}')">output</span>
      </div>
      ${assertions}
      <div class="iter-output" id="${outputId}">${escHtml(r.output || '(no output)')}</div>
    </div>`;
  }).join('');

  return `<div class="card">
  <div class="step-header" onclick="toggleIterations(${index})">
    <div>
      <span class="step-icon" style="color:${iconColor}">${icon}</span>
      <span class="step-name">${escHtml(step.stepId)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:0.75rem;">
      <span class="step-rate">${pct}% (threshold: ${threshPct}%)</span>
      <span class="chevron" id="chev-${index}">&#9654;</span>
    </div>
  </div>
  <div class="bar-container"><div class="bar-fill ${barColor}" style="width:${pct}%"></div></div>
  <div class="step-stats">
    <span>${step.passes}/${step.totalRuns} passed</span>
    <span>${step.failures} failed</span>
    ${avgDur ? `<span>avg ${avgDur}</span>` : ''}
    ${costStr ? `<span>${costStr}</span>` : ''}
  </div>
  <div class="iterations" id="iters-${index}">
    ${iterRows}
  </div>
</div>`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
