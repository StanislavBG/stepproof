import * as fs from 'node:fs';
import * as path from 'node:path';
const BASELINE_DIR = path.resolve('.stepproof', 'baselines');
/** Sanitize scenario name into a safe filename */
function toFilename(scenarioName) {
    return scenarioName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}
function baselinePath(scenarioName) {
    return path.join(BASELINE_DIR, `${toFilename(scenarioName)}.json`);
}
function baselineYamlPath(scenarioName) {
    return path.join(BASELINE_DIR, `${toFilename(scenarioName)}.yaml`);
}
export function saveBaseline(scenarioName, report, scenarioYaml) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(baselinePath(scenarioName), JSON.stringify(report, null, 2), 'utf-8');
    if (scenarioYaml !== undefined) {
        fs.writeFileSync(baselineYamlPath(scenarioName), scenarioYaml, 'utf-8');
    }
}
export function loadBaselineYaml(scenarioName) {
    const fp = baselineYamlPath(scenarioName);
    try {
        if (!fs.existsSync(fp))
            return null;
        return fs.readFileSync(fp, 'utf-8');
    }
    catch {
        return null;
    }
}
export function loadBaseline(scenarioName) {
    const fp = baselinePath(scenarioName);
    try {
        if (!fs.existsSync(fp))
            return null;
        return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function compareWithBaseline(current, baseline) {
    // Build a lookup from baseline step summaries — O(m) where m = baseline steps
    const baselineMap = new Map(baseline.steps.map(s => [s.stepId, s.passRate]));
    const steps = current.steps.map(s => {
        const baselineRate = baselineMap.get(s.stepId) ?? 0;
        const delta = s.passRate - baselineRate;
        return {
            stepId: s.stepId,
            currentRate: s.passRate,
            baselineRate,
            delta,
            regression: delta < 0,
        };
    });
    return {
        steps,
        hasRegression: steps.some(s => s.regression),
    };
}
export function resetBaseline(scenarioName) {
    if (scenarioName) {
        const fp = baselinePath(scenarioName);
        if (fs.existsSync(fp)) {
            fs.unlinkSync(fp);
        }
    }
    else {
        // Delete all baselines
        if (fs.existsSync(BASELINE_DIR)) {
            const files = fs.readdirSync(BASELINE_DIR);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    fs.unlinkSync(path.join(BASELINE_DIR, file));
                }
            }
        }
    }
}
export function listBaselines() {
    if (!fs.existsSync(BASELINE_DIR))
        return [];
    const files = fs.readdirSync(BASELINE_DIR).filter(f => f.endsWith('.json'));
    const results = [];
    for (const file of files) {
        const fp = path.join(BASELINE_DIR, file);
        try {
            const report = JSON.parse(fs.readFileSync(fp, 'utf-8'));
            results.push({ scenarioName: report.scenarioName, filePath: fp, report });
        }
        catch {
            // skip corrupted
        }
    }
    return results;
}
//# sourceMappingURL=baseline.js.map