import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseScenario, substituteVariables } from '../../src/core/scenario-parser.js';

function writeTempScenario(content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepproof-edge-'));
  const filePath = path.join(tmpDir, 'scenario.yaml');
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('parseScenario — edge cases', () => {
  it('throws on empty file', () => {
    const filePath = writeTempScenario('');
    expect(() => parseScenario(filePath)).toThrow();
  });

  it('throws on steps array that is empty', () => {
    const filePath = writeTempScenario(`
name: "Empty Steps"
steps: []
`);
    expect(() => parseScenario(filePath)).toThrow('steps');
  });

  it('throws on whitespace-only file', () => {
    const filePath = writeTempScenario('   \n\n  ');
    expect(() => parseScenario(filePath)).toThrow();
  });

  it('parses scenario with two steps and cross-step output reference', () => {
    const filePath = writeTempScenario(`
name: "Multi-Step Scenario"
iterations: 3
variables:
  topic: "typescript"
steps:
  - id: step_a
    provider: anthropic
    model: claude-haiku-4-5-20251001
    prompt: "Describe {{topic}}"
    min_pass_rate: 0.7
    assertions:
      - type: contains
        value: "type"
      - type: not_contains
        value: "error"
  - id: step_b
    provider: openai
    model: gpt-4o-mini
    prompt: "Given {{step_a.output}}, give one example"
    min_pass_rate: 0.9
`);
    const scenario = parseScenario(filePath);
    expect(scenario.iterations).toBe(3);
    expect(scenario.steps).toHaveLength(2);
    expect(scenario.steps[0].assertions).toHaveLength(2);
    expect(scenario.steps[1].id).toBe('step_b');
    expect(scenario.steps[1].prompt).toContain('{{step_a.output}}');
  });

  it('handles Unicode in scenario name and prompt', () => {
    const filePath = writeTempScenario(`
name: "日本語テスト"
steps:
  - id: unicode_step
    provider: anthropic
    model: claude-haiku-4-5-20251001
    prompt: "Translate: こんにちは"
`);
    const scenario = parseScenario(filePath);
    expect(scenario.name).toBe('日本語テスト');
    expect(scenario.steps[0].prompt).toContain('こんにちは');
  });

  it('defaults min_pass_rate to 0.8 when omitted', () => {
    const filePath = writeTempScenario(`
name: "Defaults Test"
steps:
  - id: no_threshold
    provider: anthropic
    model: claude-haiku-4-5-20251001
    prompt: "Hello"
`);
    const scenario = parseScenario(filePath);
    expect(scenario.steps[0].min_pass_rate).toBe(0.8);
  });

  it('defaults iterations to 10 when omitted', () => {
    const filePath = writeTempScenario(`
name: "No Iterations"
steps:
  - id: step_one
    provider: anthropic
    model: claude-haiku-4-5-20251001
    prompt: "Hello"
`);
    const scenario = parseScenario(filePath);
    expect(scenario.iterations).toBe(10);
  });

  it('accepts min_pass_rate of 1.0 (all must pass)', () => {
    const filePath = writeTempScenario(`
name: "Strict"
steps:
  - id: strict_step
    provider: anthropic
    model: claude-haiku-4-5-20251001
    prompt: "Hello"
    min_pass_rate: 1.0
`);
    const scenario = parseScenario(filePath);
    expect(scenario.steps[0].min_pass_rate).toBe(1.0);
  });

  it('accepts min_pass_rate of 0.0 (always pass)', () => {
    const filePath = writeTempScenario(`
name: "Permissive"
steps:
  - id: permissive
    provider: anthropic
    model: claude-haiku-4-5-20251001
    prompt: "Hello"
    min_pass_rate: 0.0
`);
    const scenario = parseScenario(filePath);
    expect(scenario.steps[0].min_pass_rate).toBe(0.0);
  });
});

describe('substituteVariables — edge cases', () => {
  it('handles variable value containing curly braces', () => {
    const result = substituteVariables(
      'Value: {{input}}',
      { input: 'a {b} c' },
      {}
    );
    expect(result).toBe('Value: a {b} c');
  });

  it('handles step output that is empty string', () => {
    const result = substituteVariables(
      'Output: [{{step_one.output}}]',
      {},
      { step_one: '' }
    );
    expect(result).toBe('Output: []');
  });

  it('substitutes variable and step output in same prompt', () => {
    const result = substituteVariables(
      '{{var1}} + {{step_a.output}} + {{var2}}',
      { var1: 'A', var2: 'C' },
      { step_a: 'B' }
    );
    expect(result).toBe('A + B + C');
  });

  it('handles null/undefined step outputs gracefully', () => {
    // An unknown step reference should remain as-is
    const result = substituteVariables(
      'Context: {{missing_step.output}}',
      {},
      {}
    );
    expect(result).toBe('Context: {{missing_step.output}}');
  });

  it('handles very long variable values', () => {
    const longValue = 'x'.repeat(10_000);
    const result = substituteVariables('{{input}}', { input: longValue }, {});
    expect(result).toBe(longValue);
  });

  it('handles prompt with no variables at all', () => {
    const result = substituteVariables('No variables here!', { foo: 'bar' }, { step: 'val' });
    expect(result).toBe('No variables here!');
  });
});
