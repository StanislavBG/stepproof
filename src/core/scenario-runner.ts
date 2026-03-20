import * as path from 'node:path';
import { getAdapter } from '../adapters/index.js';
import { runAssertions } from '../assertions/engine.js';
import { substituteVariables } from './scenario-parser.js';
import type { Scenario, ScenarioReport, StepResult, StepSummary } from './types.js';

export interface RunOptions {
  /** Override iterations from scenario file */
  iterations?: number;
  /** Called after each iteration completes */
  onIterationComplete?: (iteration: number, total: number) => void;
  /** Called after each step within an iteration */
  onStepComplete?: (stepId: string, passed: boolean) => void;
}

export async function runScenario(
  scenario: Scenario,
  scenarioFilePath: string,
  options: RunOptions = {}
): Promise<ScenarioReport> {
  const iterations = options.iterations ?? scenario.iterations ?? 10;
  const scenarioDir = path.dirname(path.resolve(scenarioFilePath));
  const variables = scenario.variables ?? {};

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const allResults: StepResult[] = [];

  for (let i = 1; i <= iterations; i++) {
    const stepOutputs: Record<string, string> = {};

    for (const step of scenario.steps) {
      const resolvedPrompt = substituteVariables(step.prompt, variables, stepOutputs);
      const resolvedSystem = step.system
        ? substituteVariables(step.system, variables, stepOutputs)
        : undefined;

      const stepStartMs = Date.now();
      let output = '';
      let error: string | undefined;

      try {
        const adapter = getAdapter(step.provider, step.model);
        output = await adapter.call(resolvedPrompt, resolvedSystem);
        stepOutputs[step.id] = output;
      } catch (e) {
        error = (e as Error).message;
        stepOutputs[step.id] = '';
      }

      const durationMs = Date.now() - stepStartMs;

      let assertionResults: { type: string; passed: boolean; message?: string }[] = [];
      let assertionsPassed = false;

      if (!error) {
        const { results, allPassed } = await runAssertions(output, step.assertions, scenarioDir);
        assertionResults = results;
        assertionsPassed = allPassed;
      }

      const stepPassed = !error && assertionsPassed;

      const result: StepResult = {
        stepId: step.id,
        iteration: i,
        output,
        passed: stepPassed,
        assertionResults,
        error,
        durationMs,
      };

      allResults.push(result);
      options.onStepComplete?.(step.id, stepPassed);
    }

    options.onIterationComplete?.(i, iterations);
  }

  // Aggregate per-step summaries
  const steps: StepSummary[] = scenario.steps.map((step) => {
    const stepResults = allResults.filter((r) => r.stepId === step.id);
    const passes = stepResults.filter((r) => r.passed).length;
    const failures = stepResults.length - passes;
    const passRate = stepResults.length > 0 ? passes / stepResults.length : 0;
    const minPassRate = step.min_pass_rate ?? 0.8;

    return {
      stepId: step.id,
      totalRuns: stepResults.length,
      passes,
      failures,
      passRate,
      minPassRate,
      belowThreshold: passRate < minPassRate,
    };
  });

  const allPassed = steps.every((s) => !s.belowThreshold);
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  return {
    scenarioName: scenario.name,
    iterations,
    startedAt,
    completedAt,
    durationMs,
    steps,
    allPassed,
    results: allResults,
  };
}
