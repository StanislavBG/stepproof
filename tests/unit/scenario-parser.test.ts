import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseScenario, substituteVariables } from '../../src/core/scenario-parser.js';

function writeTempScenario(content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepproof-parser-'));
  const filePath = path.join(tmpDir, 'scenario.yaml');
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('parseScenario', () => {
  it('parses a valid minimal scenario', () => {
    const filePath = writeTempScenario(`
name: "Test Scenario"
steps:
  - id: step_one
    provider: anthropic
    model: claude-haiku-4-5-20251001
    prompt: "Hello world"
`);
    const scenario = parseScenario(filePath);
    expect(scenario.name).toBe('Test Scenario');
    expect(scenario.steps).toHaveLength(1);
    expect(scenario.steps[0].id).toBe('step_one');
    expect(scenario.iterations).toBe(10); // default
    expect(scenario.steps[0].min_pass_rate).toBe(0.8); // default
    expect(scenario.steps[0].assertions).toEqual([]); // default
  });

  it('parses iterations and variables', () => {
    const filePath = writeTempScenario(`
name: "Full Scenario"
iterations: 20
variables:
  input: "test input"
steps:
  - id: classify
    provider: openai
    model: gpt-4o-mini
    prompt: "Classify: {{input}}"
    min_pass_rate: 0.95
    assertions:
      - type: contains
        value: "positive"
`);
    const scenario = parseScenario(filePath);
    expect(scenario.iterations).toBe(20);
    expect(scenario.variables?.input).toBe('test input');
    expect(scenario.steps[0].min_pass_rate).toBe(0.95);
    expect(scenario.steps[0].assertions).toHaveLength(1);
  });

  it('throws on missing name', () => {
    const filePath = writeTempScenario(`
steps:
  - id: step_one
    provider: anthropic
    model: claude-haiku-4-5-20251001
    prompt: "Hello"
`);
    expect(() => parseScenario(filePath)).toThrow('name');
  });

  it('throws on missing steps', () => {
    const filePath = writeTempScenario(`name: "No Steps"`);
    expect(() => parseScenario(filePath)).toThrow('steps');
  });

  it('throws on invalid provider', () => {
    const filePath = writeTempScenario(`
name: "Bad Provider"
steps:
  - id: step_one
    provider: mistral
    model: mistral-7b
    prompt: "Hello"
`);
    expect(() => parseScenario(filePath)).toThrow('provider');
  });

  it('throws on non-existent file', () => {
    expect(() => parseScenario('/nonexistent/path/scenario.yaml')).toThrow('Cannot read');
  });

  it('throws on invalid YAML', () => {
    const filePath = writeTempScenario(`
name: [invalid
  yaml: here
`);
    expect(() => parseScenario(filePath)).toThrow('Invalid YAML');
  });
});

describe('substituteVariables', () => {
  it('substitutes global variables', () => {
    const result = substituteVariables(
      'Classify: {{input}}',
      { input: 'Hello world' },
      {}
    );
    expect(result).toBe('Classify: Hello world');
  });

  it('substitutes step output references', () => {
    const result = substituteVariables(
      'Given {{step_one.output}}, respond to: {{input}}',
      { input: 'test' },
      { step_one: 'POSITIVE intent detected' }
    );
    expect(result).toBe('Given POSITIVE intent detected, respond to: test');
  });

  it('leaves unresolved variables as-is', () => {
    const result = substituteVariables(
      'Hello {{unknown}}',
      {},
      {}
    );
    expect(result).toBe('Hello {{unknown}}');
  });

  it('handles multiple substitutions of same variable', () => {
    const result = substituteVariables(
      '{{input}} and {{input}}',
      { input: 'foo' },
      {}
    );
    expect(result).toBe('foo and foo');
  });

  it('handles empty template', () => {
    const result = substituteVariables('', {}, {});
    expect(result).toBe('');
  });
});
