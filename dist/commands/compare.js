import { runScenario } from '../core/scenario-runner.js';
/**
 * Run the same scenario against multiple providers and produce a comparison.
 * Substitutes provider/model on ALL steps for each provider run.
 */
export async function runComparison(scenario, scenarioFilePath, providers, iterations, options = {}) {
    const startMs = Date.now();
    const results = [];
    for (const spec of providers) {
        options.onProviderStart?.(spec.provider, spec.model);
        // Clone scenario with overridden provider/model on all steps
        const overriddenScenario = {
            ...scenario,
            iterations,
            steps: scenario.steps.map(step => ({
                ...step,
                provider: spec.provider,
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
    const stepBreakdown = stepIds.map(stepId => {
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
export function parseProviderSpecs(input) {
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
//# sourceMappingURL=compare.js.map