import * as fs from 'node:fs';
export function writeJsonReport(report, outputPath) {
    const json = JSON.stringify(report, null, 2);
    fs.writeFileSync(outputPath, json, 'utf-8');
}
export function formatJsonReport(report) {
    return JSON.stringify(report, null, 2);
}
//# sourceMappingURL=json-reporter.js.map