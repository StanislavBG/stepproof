import type { Scenario, ScenarioReport } from './types.js';
export interface CacheStats {
    hits: number;
    misses: number;
}
export interface RunOptions {
    /** Override iterations from scenario file */
    iterations?: number;
    /** Called after each iteration completes */
    onIterationComplete?: (iteration: number, total: number) => void;
    /** Called after each step within an iteration */
    onStepComplete?: (stepId: string, passed: boolean) => void;
    /** Disable LLM response caching */
    noCache?: boolean;
    /** Populated after run — cache hit/miss stats */
    cacheStats?: CacheStats;
}
export declare function runScenario(scenario: Scenario, scenarioFilePath: string, options?: RunOptions): Promise<ScenarioReport>;
//# sourceMappingURL=scenario-runner.d.ts.map