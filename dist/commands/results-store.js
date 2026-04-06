import * as fs from 'node:fs';
import * as path from 'node:path';
const RESULTS_DIR_NAME = '.stepproof/results';
const MAX_REPORTS_PER_SCENARIO = 10;
/** Get results directory path (relative to cwd) */
export function getResultsDir() {
    return path.resolve(process.cwd(), RESULTS_DIR_NAME);
}
/** Slugify scenario name for use in filenames */
function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
/**
 * Save a report to .stepproof/results/{slug}-{timestamp}.json
 * Prunes old reports to keep only the last MAX_REPORTS_PER_SCENARIO per scenario.
 */
export function saveReport(report) {
    const dir = getResultsDir();
    fs.mkdirSync(dir, { recursive: true });
    const slug = slugify(report.scenarioName);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${slug}-${timestamp}.json`;
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf8');
    // Prune: keep only last MAX_REPORTS_PER_SCENARIO for this scenario slug
    const prefix = slug + '-';
    const allForScenario = fs.readdirSync(dir)
        .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
        .sort()
        .reverse(); // newest first (ISO timestamps sort lexicographically)
    // O(n) single pass — n is bounded by report count per scenario
    for (let i = MAX_REPORTS_PER_SCENARIO; i < allForScenario.length; i++) {
        try {
            fs.unlinkSync(path.join(dir, allForScenario[i]));
        }
        catch { /* ignore */ }
    }
    return filepath;
}
/** Find the most recent report file across all scenarios */
export function findLatestReport() {
    const dir = getResultsDir();
    if (!fs.existsSync(dir))
        return undefined;
    const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();
    return files.length > 0 ? path.join(dir, files[0]) : undefined;
}
/** Find the most recent report for a specific scenario (by name or slug prefix match) */
export function findLatestReportForScenario(scenario) {
    const dir = getResultsDir();
    if (!fs.existsSync(dir))
        return undefined;
    const slug = slugify(scenario);
    const prefix = slug + '-';
    const files = fs.readdirSync(dir)
        .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
        .sort()
        .reverse();
    return files.length > 0 ? path.join(dir, files[0]) : undefined;
}
/** List recent report files, optionally filtered by scenario. Returns newest first. */
export function listReports(scenario) {
    const dir = getResultsDir();
    if (!fs.existsSync(dir))
        return [];
    let files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    if (scenario) {
        const slug = slugify(scenario);
        const prefix = slug + '-';
        files = files.filter(f => f.startsWith(prefix));
    }
    return files.sort().reverse().map(f => path.join(dir, f));
}
//# sourceMappingURL=results-store.js.map