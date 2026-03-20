import * as fs from 'node:fs';
import * as yaml from 'js-yaml';
import type { Scenario, Step } from './types.js';

export function parseScenario(filePath: string): Scenario {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    throw new Error(`Cannot read scenario file: ${filePath}`);
  }

  let raw: unknown;
  try {
    raw = yaml.load(content);
  } catch (e) {
    throw new Error(`Invalid YAML in scenario file: ${(e as Error).message}`);
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('Scenario file must be a YAML object');
  }

  const scenario = raw as Record<string, unknown>;

  if (!scenario.name || typeof scenario.name !== 'string') {
    throw new Error('Scenario must have a "name" field (string)');
  }

  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
    throw new Error('Scenario must have a "steps" array with at least one step');
  }

  const steps = scenario.steps.map((rawStep: unknown, i: number) => validateStep(rawStep, i));

  return {
    name: scenario.name,
    iterations: typeof scenario.iterations === 'number' ? scenario.iterations : 10,
    variables: typeof scenario.variables === 'object' && scenario.variables !== null
      ? scenario.variables as Record<string, string>
      : {},
    steps,
  };
}

function validateStep(raw: unknown, index: number): Step {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Step ${index + 1} must be an object`);
  }

  const step = raw as Record<string, unknown>;
  const pos = step.id ? `step "${step.id}"` : `step ${index + 1}`;

  if (!step.id || typeof step.id !== 'string') {
    throw new Error(`Step ${index + 1} must have an "id" field (string)`);
  }

  if (!step.provider || !['openai', 'anthropic'].includes(step.provider as string)) {
    throw new Error(`${pos}: "provider" must be "openai" or "anthropic"`);
  }

  if (!step.model || typeof step.model !== 'string') {
    throw new Error(`${pos}: "model" field is required (string)`);
  }

  if (!step.prompt || typeof step.prompt !== 'string') {
    throw new Error(`${pos}: "prompt" field is required (string)`);
  }

  const minPassRate = typeof step.min_pass_rate === 'number' ? step.min_pass_rate : 0.8;
  if (minPassRate < 0 || minPassRate > 1) {
    throw new Error(`${pos}: "min_pass_rate" must be between 0.0 and 1.0`);
  }

  return {
    id: step.id,
    provider: step.provider as 'openai' | 'anthropic',
    model: step.model as string,
    prompt: step.prompt as string,
    system: typeof step.system === 'string' ? step.system : undefined,
    min_pass_rate: minPassRate,
    assertions: Array.isArray(step.assertions) ? step.assertions : [],
  };
}

export function substituteVariables(
  template: string,
  variables: Record<string, string>,
  stepOutputs: Record<string, string>
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmed = key.trim();

    // Check for step output reference: {{step_id.output}}
    if (trimmed.includes('.')) {
      const [stepId, field] = trimmed.split('.', 2);
      if (field === 'output' && stepOutputs[stepId] !== undefined) {
        return stepOutputs[stepId];
      }
    }

    // Check global variables
    if (variables[trimmed] !== undefined) {
      return variables[trimmed];
    }

    // Check environment variables
    if (process.env[trimmed] !== undefined) {
      return process.env[trimmed]!;
    }

    // Leave unresolved — caller decides if this is an error
    return match;
  });
}
