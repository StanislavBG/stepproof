import type { ScenarioReport } from '../core/types.js';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function formatJunit(report: ScenarioReport): string {
  const totalTests = report.steps.length;
  const totalFailures = report.steps.filter((s) => s.belowThreshold).length;
  const timeSeconds = (report.durationMs / 1000).toFixed(3);

  const testCases = report.steps.map((step) => {
    const passRatePct = (step.passRate * 100).toFixed(1);
    const thresholdPct = (step.minPassRate * 100).toFixed(0);

    const openTag = `    <testcase name="${escapeXml(step.stepId)}" classname="stepproof.steps" time="0">`;

    if (step.belowThreshold) {
      const failureMessage = `Pass rate ${passRatePct}% below threshold ${thresholdPct}%`;
      const failureBody = `${escapeXml(step.stepId)}: ${step.passes}/${step.totalRuns} iterations passed`;
      return `${openTag}\n      <failure message="${escapeXml(failureMessage)}">${escapeXml(failureBody)}</failure>\n    </testcase>`;
    }

    return `${openTag}\n    </testcase>`;
  });

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="stepproof" tests="${totalTests}" failures="${totalFailures}" time="${timeSeconds}">`,
    `  <testsuite name="${escapeXml(report.scenarioName)}" tests="${totalTests}" failures="${totalFailures}" time="${timeSeconds}">`,
    ...testCases,
    '  </testsuite>',
    '</testsuites>',
  ];

  return lines.join('\n');
}
