import type { ScenarioReport } from '../core/types.js';
import type { BaselineComparison } from '../baseline.js';
import type { CacheStats } from '../core/scenario-runner.js';
import type { ComparisonReport } from '../commands/compare.js';
export interface PrintReportOptions {
    reportPath?: string;
    baselineComparison?: BaselineComparison;
    cacheStats?: CacheStats;
}
export declare function printReport(report: ScenarioReport, reportPathOrOpts?: string | PrintReportOptions): void;
export declare function printProgress(stepId: string, iteration: number, total: number): void;
export declare function formatComparison(report: ComparisonReport): string;
//# sourceMappingURL=terminal-reporter.d.ts.map