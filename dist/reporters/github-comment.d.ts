import type { ScenarioReport } from '../core/types.js';
import type { BaselineComparison } from '../baseline.js';
/**
 * Format a ScenarioReport as a GitHub PR comment in markdown.
 * Includes a marker comment so the action can update existing comments.
 */
export declare function formatPRComment(report: ScenarioReport, baselineComparison?: BaselineComparison): string;
//# sourceMappingURL=github-comment.d.ts.map