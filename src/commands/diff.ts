import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { loadBaseline, loadBaselineYaml } from '../baseline.js';

interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
}

/**
 * Compute a simple line-by-line diff between two strings.
 * Uses a basic LCS approach — O(n*m) time and space where n,m = line counts.
 * Fine for scenario files which are typically <200 lines.
 */
function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const n = oldLines.length;
  const m = newLines.length;

  // LCS table — O(n*m)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'same', text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'added', text: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: 'removed', text: oldLines[i - 1] });
      i--;
    }
  }

  result.reverse();
  return result;
}

interface StepChange {
  stepId: string;
  modelOld?: string;
  modelNew?: string;
  modelChanged: boolean;
  promptOld?: string;
  promptNew?: string;
  promptChanged: boolean;
  systemOld?: string;
  systemNew?: string;
  systemChanged: boolean;
  assertionsChanged: boolean;
  assertionsDiff?: string;
  oldPassRate?: number;
  newPassRate?: number;
  anyChange: boolean;
}

interface ParsedStep {
  id: string;
  model?: string;
  prompt?: string;
  system?: string;
  assertions?: unknown[];
}

function extractSteps(yamlContent: string): Map<string, ParsedStep> {
  const map = new Map<string, ParsedStep>();
  try {
    const parsed = yaml.load(yamlContent) as Record<string, unknown> | null;
    if (!parsed || !Array.isArray(parsed.steps)) return map;
    for (const step of parsed.steps) {
      if (step && typeof step === 'object' && typeof step.id === 'string') {
        map.set(step.id, {
          id: step.id,
          model: typeof step.model === 'string' ? step.model : undefined,
          prompt: typeof step.prompt === 'string' ? step.prompt : undefined,
          system: typeof step.system === 'string' ? step.system : undefined,
          assertions: Array.isArray(step.assertions) ? step.assertions : undefined,
        });
      }
    }
  } catch {
    // If YAML parse fails, return empty
  }
  return map;
}

function formatPromptDiff(oldPrompt: string, newPrompt: string): string[] {
  const lines: string[] = [];
  const diff = computeLineDiff(oldPrompt, newPrompt);
  for (const d of diff) {
    if (d.type === 'removed') {
      lines.push(chalk.red(`        - "${d.text}"`));
    } else if (d.type === 'added') {
      lines.push(chalk.green(`        + "${d.text}"`));
    }
    // skip 'same' lines for prompt diff — only show changes
  }
  return lines;
}

export function runDiff(scenarioPath: string): void {
  const resolvedPath = path.resolve(process.cwd(), scenarioPath);

  // Read current scenario YAML
  let currentYaml: string;
  try {
    currentYaml = fs.readFileSync(resolvedPath, 'utf-8');
  } catch {
    console.error(`\nError: Cannot read scenario file: ${resolvedPath}\n`);
    process.exit(2);
  }

  // Extract scenario name from current YAML
  let scenarioName: string;
  try {
    const parsed = yaml.load(currentYaml) as Record<string, unknown>;
    scenarioName = parsed.name as string;
    if (!scenarioName) throw new Error('no name');
  } catch {
    console.error('\nError: Cannot parse scenario name from YAML\n');
    process.exit(2);
    return; // unreachable, but TS needs it
  }

  // Load baseline YAML
  const baselineYaml = loadBaselineYaml(scenarioName);
  if (!baselineYaml) {
    console.error(`\nNo baseline found for "${scenarioName}".`);
    console.error('Run `stepproof run` first to create a baseline.\n');
    process.exit(1);
    return;
  }

  // Load baseline report for pass rates
  const baselineReport = loadBaseline(scenarioName);
  const baselineRates = new Map<string, number>();
  if (baselineReport) {
    for (const s of baselineReport.steps) {
      baselineRates.set(s.stepId, s.passRate);
    }
  }

  // Extract steps from both versions
  const oldSteps = extractSteps(baselineYaml);
  const newSteps = extractSteps(currentYaml);

  // Determine the baseline timestamp
  const baselineDate = baselineReport?.completedAt ?? 'unknown';

  console.log('');
  console.log(chalk.bold(`stepproof diff — ${scenarioName}`));
  console.log(chalk.dim(`Changes since last baseline (${baselineDate}):`));
  console.log('');

  // Collect all step IDs (union of old and new)
  const allStepIds = new Set([...oldSteps.keys(), ...newSteps.keys()]);
  let hasAnyChange = false;

  for (const stepId of allStepIds) {
    const oldStep = oldSteps.get(stepId);
    const newStep = newSteps.get(stepId);

    if (!oldStep && newStep) {
      // New step added
      hasAnyChange = true;
      console.log(`  ${chalk.bold(stepId)} ${chalk.green('(new step)')}`);
      console.log('');
      continue;
    }

    if (oldStep && !newStep) {
      // Step removed
      hasAnyChange = true;
      console.log(`  ${chalk.bold(stepId)} ${chalk.red('(removed)')}`);
      console.log('');
      continue;
    }

    if (!oldStep || !newStep) continue;

    const changes: string[] = [];

    // Model change
    if (oldStep.model !== newStep.model) {
      changes.push(`    ${chalk.dim('model:')} ${chalk.red(oldStep.model ?? '(none)')} → ${chalk.green(newStep.model ?? '(none)')}  ${chalk.yellow('(changed)')}`);
    }

    // System prompt change
    if (oldStep.system !== newStep.system) {
      if (!oldStep.system && newStep.system) {
        changes.push(`    ${chalk.dim('system:')} ${chalk.green('(added)')}`);
        changes.push(chalk.green(`      + "${newStep.system}"`));
      } else if (oldStep.system && !newStep.system) {
        changes.push(`    ${chalk.dim('system:')} ${chalk.red('(removed)')}`);
      } else if (oldStep.system && newStep.system) {
        changes.push(`    ${chalk.dim('system:')}`);
        changes.push(...formatPromptDiff(oldStep.system, newStep.system));
      }
    }

    // Prompt change
    if (oldStep.prompt !== newStep.prompt) {
      if (oldStep.prompt && newStep.prompt) {
        changes.push(`    ${chalk.dim('prompt:')}`);
        changes.push(...formatPromptDiff(oldStep.prompt, newStep.prompt));
      } else if (!oldStep.prompt && newStep.prompt) {
        changes.push(`    ${chalk.dim('prompt:')} ${chalk.green('(added)')}`);
      } else if (oldStep.prompt && !newStep.prompt) {
        changes.push(`    ${chalk.dim('prompt:')} ${chalk.red('(removed)')}`);
      }
    }

    // Assertions change
    const oldAssertStr = JSON.stringify(oldStep.assertions ?? []);
    const newAssertStr = JSON.stringify(newStep.assertions ?? []);
    if (oldAssertStr !== newAssertStr) {
      changes.push(`    ${chalk.dim('assertions:')} ${chalk.yellow('(changed)')}`);
    }

    if (changes.length > 0) {
      hasAnyChange = true;
      console.log(`  ${chalk.bold(stepId)}`);
      for (const line of changes) {
        console.log(line);
      }

      // Show pass rate change if baseline has rates
      const oldRate = baselineRates.get(stepId);
      if (oldRate !== undefined) {
        const pct = (oldRate * 100).toFixed(0);
        console.log(`    ${chalk.dim(`pass rate at baseline: ${pct}%`)}`);
      }

      console.log('');
    } else {
      // No changes for this step — show it as unchanged with pass rate if available
      const rate = baselineRates.get(stepId);
      if (rate !== undefined) {
        const pct = (rate * 100).toFixed(0);
        console.log(`  ${chalk.bold(stepId)} ${chalk.dim('(no changes)')}`);
        console.log(`    ${chalk.dim(`pass rate at baseline: ${pct}%`)}`);
        console.log('');
      } else {
        console.log(`  ${chalk.bold(stepId)} ${chalk.dim('(no changes)')}`);
        console.log('');
      }
    }
  }

  // Full raw diff
  if (hasAnyChange) {
    console.log(chalk.dim('─'.repeat(50)));
    console.log(chalk.dim('Raw YAML diff:'));
    console.log('');
    const rawDiff = computeLineDiff(baselineYaml, currentYaml);
    let contextWindow = 0;
    for (let idx = 0; idx < rawDiff.length; idx++) {
      const d = rawDiff[idx];
      if (d.type === 'removed') {
        console.log(chalk.red(`  - ${d.text}`));
        contextWindow = 3;
      } else if (d.type === 'added') {
        console.log(chalk.green(`  + ${d.text}`));
        contextWindow = 3;
      } else if (contextWindow > 0) {
        console.log(chalk.dim(`    ${d.text}`));
        contextWindow--;
      }
    }
  } else {
    console.log(chalk.dim('No changes detected between current scenario and baseline.'));
  }

  console.log('');
}
