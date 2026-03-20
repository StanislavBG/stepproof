import type { Assertion, AssertionResult } from '../core/types.js';
export declare function runAssertions(output: string, assertions: Assertion[], scenarioDir: string): Promise<{
    results: AssertionResult[];
    allPassed: boolean;
}>;
//# sourceMappingURL=engine.d.ts.map