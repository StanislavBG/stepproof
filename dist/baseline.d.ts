import type { ScenarioReport } from './core/types.js';
export interface StepComparison {
    stepId: string;
    currentRate: number;
    baselineRate: number;
    delta: number;
    regression: boolean;
}
export interface BaselineComparison {
    steps: StepComparison[];
    hasRegression: boolean;
}
export declare function saveBaseline(scenarioName: string, report: ScenarioReport): void;
export declare function loadBaseline(scenarioName: string): ScenarioReport | null;
export declare function compareWithBaseline(current: ScenarioReport, baseline: ScenarioReport): BaselineComparison;
export declare function resetBaseline(scenarioName?: string): void;
export declare function listBaselines(): Array<{
    scenarioName: string;
    filePath: string;
    report: ScenarioReport;
}>;
//# sourceMappingURL=baseline.d.ts.map