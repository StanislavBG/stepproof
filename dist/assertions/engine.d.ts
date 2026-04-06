import type { Assertion, AssertionResult } from '../core/types.js';
/** Context passed from the runner for cost/latency assertions */
export interface AssertionContext {
    durationMs?: number;
    costUsd?: number;
}
export declare function runAssertions(output: string, assertions: Assertion[], scenarioDir: string, ctx?: AssertionContext): Promise<{
    results: AssertionResult[];
    allPassed: boolean;
}>;
//# sourceMappingURL=engine.d.ts.map