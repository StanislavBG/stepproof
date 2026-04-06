import type { Scenario, ScenarioReport, StepSummary } from '../core/types.js';
import { runScenario } from '../core/scenario-runner.js';

export interface ProviderSpec {
  provider: string;
  model: string;
}

export interface ProviderResult {
  provider: string;
  model: string;
  report: ScenarioReport;
}

export interface StepBreakdown {
  stepId: string;
  rates: Array<{ provider: string; model: string; passRate: number; passes: number; totalRuns: number }>;
  bestProvider: string;
  bestModel: string;
}

export interface ComparisonReport {
  scenarioName: string;
  iterations: number;
  providers: ProviderResult[];
  winner: string;
  winnerModel: string;
  stepBreakdown: StepBreakdown[];
  durationMs: number;
}

/**
 * Run the same scenario against multiple providers and produce a comparison.
 * Substitutes provider/model on ALL steps for each provider run.
 */
export async function runComparison(
  scenario: Scenario,
  scenarioFilePath: string,
  providers: ProviderSpec[],
  iterations: number,
  options: {
    quiet?: boolean;
    onProviderStart?: (provider: string, model: string) => void;
    onIterationComplete?: (provider: string, iteration: number, total: number) => void;
  } = {}
): Promise<ComparisonReport> {
  const startMs = Date.now();
  const results: ProviderResult[] = [];

  for (const spec of providers) {
    options.onProviderStart?.(spec.provider, spec.model);

    // Clone scenario with overridden provider/model on all steps
    const overriddenScenario: Scenario = {
      ...scenario,
      iterations,
      steps: scenario.steps.map(step => ({
        ...step,
        provider: spec.provider as Scenario['steps'][0]['provider'],
        model: spec.model,
      })),
    };

    const report = await runScenario(overriddenScenario, scenarioFilePath, {
      iterations,
      onIterationComplete: (iter, total) => {
        options.onIterationComplete?.(spec.provider, iter, total);
      },
    });

    results.push({ provider: spec.provider, model: spec.model, report });
  }

  // Build step breakdown — compare pass rates per step across providers
  const stepIds = scenario.steps.map(s => s.id);
  const stepBreakdown: StepBreakdown[] = stepIds.map(stepId => {
    const rates = results.map(r => {
      const stepSummary = r.report.steps.find(s => s.stepId === stepId);
      return {
        provider: r.provider,
        model: r.model,
        passRate: stepSummary?.passRate ?? 0,
        passes: stepSummary?.passes ?? 0,
        totalRuns: stepSummary?.totalRuns ?? 0,
      };
    });
    const best = rates.reduce((a, b) => a.passRate >= b.passRate ? a : b);
    return { stepId, rates, bestProvider: best.provider, bestModel: best.model };
  });

  // Overall winner: highest average pass rate across all steps
  const avgRates = results.map(r => {
    const avg = r.report.steps.reduce((sum, s) => sum + s.passRate, 0) / r.report.steps.length;
    return { provider: r.provider, model: r.model, avg };
  });
  const winner = avgRates.reduce((a, b) => a.avg >= b.avg ? a : b);

  return {
    scenarioName: scenario.name,
    iterations,
    providers: results,
    winner: winner.provider,
    winnerModel: winner.model,
    stepBreakdown,
    durationMs: Date.now() - startMs,
  };
}

/** Parse "provider:model" strings like "anthropic:claude-sonnet-4-6,openai:gpt-4o" */
export function parseProviderSpecs(input: string): ProviderSpec[] {
  return input.split(',').map(s => {
    const trimmed = s.trim();
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      throw new Error(`Invalid provider spec "${trimmed}" — expected format: provider:model (e.g. anthropic:claude-sonnet-4-6)`);
    }
    return {
      provider: trimmed.slice(0, colonIdx),
      model: trimmed.slice(colonIdx + 1),
    };
  });
}
