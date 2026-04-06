import type { ScenarioReport } from '../core/types.js';
/** Get results directory path (relative to cwd) */
export declare function getResultsDir(): string;
/**
 * Save a report to .stepproof/results/{slug}-{timestamp}.json
 * Prunes old reports to keep only the last MAX_REPORTS_PER_SCENARIO per scenario.
 */
export declare function saveReport(report: ScenarioReport): string;
/** Find the most recent report file across all scenarios */
export declare function findLatestReport(): string | undefined;
/** Find the most recent report for a specific scenario (by name or slug prefix match) */
export declare function findLatestReportForScenario(scenario: string): string | undefined;
/** List recent report files, optionally filtered by scenario. Returns newest first. */
export declare function listReports(scenario?: string): string[];
//# sourceMappingURL=results-store.d.ts.map