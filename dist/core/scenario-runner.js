import * as path from 'node:path';
import { getAdapter } from '../adapters/index.js';
import { runAssertions } from '../assertions/engine.js';
import { substituteVariables } from './scenario-parser.js';
import { getCached, setCache } from '../cache.js';
// Approximate cost per 1K tokens by model
const COST_PER_1K = {
    'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
    'claude-sonnet-4-6-20260401': { input: 0.003, output: 0.015 },
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
};
function calculateCost(model, inputTokens, outputTokens) {
    const pricing = COST_PER_1K[model];
    if (!pricing)
        return 0;
    return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
}
export async function runScenario(scenario, scenarioFilePath, options = {}) {
    const iterations = options.iterations ?? scenario.iterations ?? 10;
    const scenarioDir = path.dirname(path.resolve(scenarioFilePath));
    const variables = scenario.variables ?? {};
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const allResults = [];
    const useCache = !options.noCache;
    const cacheStats = { hits: 0, misses: 0 };
    for (let i = 1; i <= iterations; i++) {
        const stepOutputs = {};
        for (const step of scenario.steps) {
            const resolvedPrompt = substituteVariables(step.prompt, variables, stepOutputs);
            const resolvedSystem = step.system
                ? substituteVariables(step.system, variables, stepOutputs)
                : undefined;
            let output = '';
            let error;
            let durationMs = 0;
            let inputTokens;
            let outputTokens;
            let costUsd;
            try {
                // Check cache before calling adapter
                let response = useCache
                    ? getCached(step.provider, step.model, resolvedPrompt, resolvedSystem)
                    : null;
                if (response !== null) {
                    cacheStats.hits++;
                }
                else {
                    const adapter = getAdapter(step.provider, step.model);
                    response = await adapter.call(resolvedPrompt, resolvedSystem);
                    cacheStats.misses++;
                    if (useCache) {
                        setCache(step.provider, step.model, resolvedPrompt, resolvedSystem, response);
                    }
                }
                output = response.text;
                durationMs = response.durationMs;
                if (response.usage) {
                    inputTokens = response.usage.inputTokens;
                    outputTokens = response.usage.outputTokens;
                    costUsd = calculateCost(step.model, inputTokens, outputTokens);
                }
                stepOutputs[step.id] = output;
            }
            catch (e) {
                error = e.message;
                cacheStats.misses++;
                stepOutputs[step.id] = '';
            }
            let assertionResults = [];
            let assertionsPassed = false;
            if (!error) {
                const { results, allPassed } = await runAssertions(output, step.assertions, scenarioDir, { durationMs, costUsd });
                assertionResults = results;
                assertionsPassed = allPassed;
            }
            const stepPassed = !error && assertionsPassed;
            const result = {
                stepId: step.id,
                iteration: i,
                output,
                passed: stepPassed,
                assertionResults,
                error,
                durationMs,
                inputTokens,
                outputTokens,
                costUsd,
            };
            allResults.push(result);
            options.onStepComplete?.(step.id, stepPassed);
        }
        options.onIterationComplete?.(i, iterations);
    }
    // Aggregate per-step summaries
    const steps = scenario.steps.map((step) => {
        const stepResults = allResults.filter((r) => r.stepId === step.id);
        const passes = stepResults.filter((r) => r.passed).length;
        const failures = stepResults.length - passes;
        const passRate = stepResults.length > 0 ? passes / stepResults.length : 0;
        const minPassRate = step.min_pass_rate ?? 0.8;
        const totalDurationMs = stepResults.reduce((s, r) => s + r.durationMs, 0);
        const avgDurationMs = stepResults.length > 0 ? totalDurationMs / stepResults.length : 0;
        const totalCostUsd = stepResults.reduce((s, r) => s + (r.costUsd ?? 0), 0);
        const avgCostUsd = stepResults.length > 0 ? totalCostUsd / stepResults.length : 0;
        return {
            stepId: step.id,
            totalRuns: stepResults.length,
            passes,
            failures,
            passRate,
            minPassRate,
            belowThreshold: passRate < minPassRate,
            avgDurationMs,
            totalCostUsd,
            avgCostUsd,
        };
    });
    const allPassed = steps.every((s) => !s.belowThreshold);
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;
    // Expose cache stats to caller
    options.cacheStats = cacheStats;
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
//# sourceMappingURL=scenario-runner.js.map