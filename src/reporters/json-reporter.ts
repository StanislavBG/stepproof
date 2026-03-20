import * as fs from 'node:fs';
import type { ScenarioReport } from '../core/types.js';

export function writeJsonReport(report: ScenarioReport, outputPath: string): void {
  const json = JSON.stringify(report, null, 2);
  fs.writeFileSync(outputPath, json, 'utf-8');
}

export function formatJsonReport(report: ScenarioReport): string {
  return JSON.stringify(report, null, 2);
}
