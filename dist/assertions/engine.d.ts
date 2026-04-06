import type { Assertion, AssertionResult } from '../core/types.js';
/** Context passed from the runner for cost/latency/streaming assertions */
export interface AssertionContext {
    durationMs?: number;
    costUsd?: number;
    streamMetrics?: {
        ttftMs: number;
        tokensPerSecond: number;
        interTokenLatencyMs: number;
    };
    /** Scenario name — used for snapshot golden file path */
    scenarioName?: string;
    /** Step ID — used for snapshot golden file path */
    stepId?: string;
}
export declare function runAssertions(output: string, assertions: Assertion[], scenarioDir: string, ctx?: AssertionContext): Promise<{
    results: AssertionResult[];
    allPassed: boolean;
}>;
/** Update a snapshot golden file (for `stepproof snapshot update` command). */
export declare function updateSnapshot(scenarioDir: string, stepId: string, output: string): string;
//# sourceMappingURL=engine.d.ts.map