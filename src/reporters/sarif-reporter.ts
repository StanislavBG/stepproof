import type { ScenarioReport } from '../core/types.js';

export function formatSarif(report: ScenarioReport): string {
  const rules = report.steps.map((step) => ({
    id: step.stepId,
    name: step.stepId,
    shortDescription: {
      text: `Step: ${step.stepId} — min pass rate ${(step.minPassRate * 100).toFixed(0)}%`,
    },
  }));

  const results = report.steps.map((step) => {
    const passRatePct = (step.passRate * 100).toFixed(1);
    const thresholdPct = (step.minPassRate * 100).toFixed(0);

    if (step.belowThreshold) {
      return {
        ruleId: step.stepId,
        level: 'error',
        message: {
          text: `Step "${step.stepId}" pass rate ${passRatePct}% is below threshold ${thresholdPct}% (${step.passes}/${step.totalRuns} iterations passed)`,
        },
      };
    }

    return {
      ruleId: step.stepId,
      level: 'none',
      message: {
        text: `Step "${step.stepId}" passed — ${passRatePct}% pass rate (${step.passes}/${step.totalRuns} iterations passed)`,
      },
    };
  });

  const sarif = {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'stepproof',
            version: '0.1.0',
            rules,
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
