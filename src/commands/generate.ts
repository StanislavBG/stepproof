import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseScenario } from '../core/scenario-parser.js';
import { getAdapter } from '../adapters/index.js';

export interface GenerateOptions {
  count: number;
  output?: string;
  append: boolean;
}

/**
 * Generate synthetic edge-case test inputs for a scenario.
 * Calls Claude Haiku with a meta-prompt to produce diverse, adversarial inputs,
 * then writes them as a CSV compatible with --dataset.
 */
export async function runGenerate(scenarioPath: string, opts: GenerateOptions): Promise<string> {
  const resolvedPath = path.resolve(process.cwd(), scenarioPath);
  const scenario = parseScenario(resolvedPath);

  // Extract prompt templates and variables from all steps
  const promptTemplates: string[] = [];
  const variableNames: string[] = [];

  for (const step of scenario.steps) {
    if (step.prompt) {
      promptTemplates.push(step.prompt);
      const matches = step.prompt.matchAll(/\{\{([^.}]+)\}\}/g);
      for (const m of matches) {
        const name = m[1].trim();
        if (!variableNames.includes(name)) {
          variableNames.push(name);
        }
      }
    }
  }

  // Include scenario-level variables as context
  const existingVars = scenario.variables ?? {};

  if (variableNames.length === 0) {
    throw new Error(
      'No template variables ({{variable}}) found in scenario prompts. ' +
      'Synthetic generation requires at least one variable to vary.'
    );
  }

  const metaPrompt = buildMetaPrompt(promptTemplates, variableNames, existingVars, opts.count);

  // Use Haiku for cost-efficiency
  const adapter = getAdapter('anthropic', 'claude-haiku-4-5-20251001');
  const response = await adapter.call(metaPrompt);

  // Parse the JSON array from the response
  let rows: Array<Record<string, string>>;
  try {
    const jsonMatch = response.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }
    rows = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('Empty array');
    }
  } catch (e) {
    throw new Error(`Failed to parse generated test inputs: ${(e as Error).message}\nRaw response:\n${response.text}`);
  }

  // Determine output path
  const scenarioBasename = path.basename(scenarioPath, path.extname(scenarioPath));
  const outputPath = opts.output
    ? path.resolve(process.cwd(), opts.output)
    : path.resolve(process.cwd(), `${scenarioBasename}-synthetic.csv`);

  // Build CSV
  const columns = variableNames;
  const csvLines: string[] = [];

  if (opts.append && fs.existsSync(outputPath)) {
    // Read existing CSV, append new rows
    const existing = fs.readFileSync(outputPath, 'utf-8').trimEnd();
    csvLines.push(existing);
  } else {
    // Write header
    csvLines.push(columns.map(escapeCsvField).join(','));
  }

  for (const row of rows) {
    const line = columns.map(col => escapeCsvField(String(row[col] ?? ''))).join(',');
    csvLines.push(line);
  }

  fs.writeFileSync(outputPath, csvLines.join('\n') + '\n', 'utf-8');
  return outputPath;
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildMetaPrompt(
  templates: string[],
  variableNames: string[],
  existingVars: Record<string, string>,
  count: number
): string {
  const templateSection = templates.map((t, i) => `  Step ${i + 1}: ${t}`).join('\n');
  const varSection = variableNames.join(', ');
  const existingSection = Object.keys(existingVars).length > 0
    ? `\nExisting variable defaults:\n${Object.entries(existingVars).map(([k, v]) => `  ${k}: "${v}"`).join('\n')}`
    : '';

  return `You are a QA engineer generating diverse, edge-case test inputs for an AI pipeline.

Here are the prompt templates used in the pipeline:
${templateSection}

The template variables that need values: ${varSection}
${existingSection}

Generate exactly ${count} diverse test input rows as a JSON array. Each element is an object with keys: ${variableNames.map(v => `"${v}"`).join(', ')}.

Include a mix of:
- Normal/expected inputs
- Adversarial inputs (prompt injection attempts, jailbreak phrases)
- Edge cases (empty strings, single characters, extremely long inputs 500+ chars)
- Non-English inputs (Chinese, Arabic, Hindi, emoji-heavy)
- Special characters (HTML tags, SQL injection, null bytes, unicode)
- Ambiguous/contradictory inputs
- Very short inputs (1-2 words)
- Inputs with unusual formatting (ALL CAPS, mixed case, excessive whitespace)
- Domain-specific edge cases based on the prompt templates

Return ONLY the JSON array, no markdown fences, no explanation.`;
}
