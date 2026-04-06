import * as fs from 'node:fs';
import * as path from 'node:path';
import { getResultsDir, listReports } from './results-store.js';
import type { ScenarioReport } from '../core/types.js';

export function runHistory(scenario?: string): void {
  const resultsDir = getResultsDir();

  if (!fs.existsSync(resultsDir)) {
    console.error('\nNo results found. Run a scenario first: stepproof run ./scenarios/first-test.yaml\n');
    process.exit(2);
  }

  const files = listReports(scenario);

  if (files.length === 0) {
    if (scenario) {
      console.error(`\nNo results found for scenario "${scenario}"\n`);
    } else {
      console.error('\nNo results found. Run a scenario first.\n');
    }
    process.exit(2);
  }

  console.log('');
  console.log(scenario ? `History for: ${scenario}` : 'Recent runs');
  console.log('─'.repeat(60));

  for (const file of files) {
    try {
      const report: ScenarioReport = JSON.parse(fs.readFileSync(file, 'utf8'));
      const date = new Date(report.startedAt).toLocaleString();
      const verdict = report.allPassed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
      const duration = formatDuration(report.durationMs);
      const stepsInfo = `${report.steps.filter(s => !s.belowThreshold).length}/${report.steps.length} steps`;
      console.log(`  ${verdict}  ${report.scenarioName}  ${date}  ${duration}  ${stepsInfo}`);
    } catch {
      // Skip corrupted files
    }
  }

  console.log('');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}
