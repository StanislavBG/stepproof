import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { generateHtmlReport } from '../reporters/html-reporter.js';
import { getResultsDir, findLatestReport, findLatestReportForScenario } from './results-store.js';
import type { ScenarioReport } from '../core/types.js';

export function runView(scenario?: string): void {
  const resultsDir = getResultsDir();

  if (!fs.existsSync(resultsDir)) {
    console.error('\nNo results found. Run a scenario first: stepproof run ./scenarios/first-test.yaml\n');
    process.exit(2);
  }

  let reportPath: string | undefined;

  if (scenario) {
    reportPath = findLatestReportForScenario(scenario);
    if (!reportPath) {
      console.error(`\nNo results found for scenario "${scenario}"\n`);
      process.exit(2);
    }
  } else {
    reportPath = findLatestReport();
    if (!reportPath) {
      console.error('\nNo results found. Run a scenario first.\n');
      process.exit(2);
    }
  }

  let report: ScenarioReport;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    console.error(`\nFailed to read report: ${reportPath}\n`);
    process.exit(2);
  }

  const html = generateHtmlReport(report);
  const tmpDir = path.join(os.tmpdir(), 'stepproof');
  fs.mkdirSync(tmpDir, { recursive: true });
  const htmlPath = path.join(tmpDir, `report-${Date.now()}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');

  const openCmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';

  console.log(`\nOpening report: ${htmlPath}\n`);
  exec(`${openCmd} "${htmlPath}"`, (err) => {
    if (err) {
      console.log(`Could not open browser automatically. Open this file manually:\n  ${htmlPath}\n`);
    }
  });
}
