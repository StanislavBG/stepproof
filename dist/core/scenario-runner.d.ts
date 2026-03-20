import type { Scenario, ScenarioReport } from './types.js';
export interface RunOptions {
    /** Override iterations from scenario file */
    iterations?: number;
    /** Called after each iteration completes */
    onIterationComplete?: (iteration: number, total: number) => void;
    /** Called after each step within an iteration */
    onStepComplete?: (stepId: string, passed: boolean) => void;
}
export declare function runScenario(scenario: Scenario, scenarioFilePath: string, options?: RunOptions): Promise<ScenarioReport>;
//# sourceMappingURL=scenario-runner.d.ts.map