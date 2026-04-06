import type { Scenario, ScenarioReport } from '../core/types.js';
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
    rates: Array<{
        provider: string;
        model: string;
        passRate: number;
        passes: number;
        totalRuns: number;
    }>;
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
export declare function runComparison(scenario: Scenario, scenarioFilePath: string, providers: ProviderSpec[], iterations: number, options?: {
    quiet?: boolean;
    onProviderStart?: (provider: string, model: string) => void;
    onIterationComplete?: (provider: string, iteration: number, total: number) => void;
}): Promise<ComparisonReport>;
/** Parse "provider:model" strings like "anthropic:claude-sonnet-4-6,openai:gpt-4o" */
export declare function parseProviderSpecs(input: string): ProviderSpec[];
//# sourceMappingURL=compare.d.ts.map