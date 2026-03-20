import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { runAssertions } from '../../src/assertions/engine.js';

const NO_SCHEMA_DIR = '/tmp';

describe('contains assertion', () => {
  it('passes when output contains the value', async () => {
    const { results, allPassed } = await runAssertions(
      'The intent is: order_status',
      [{ type: 'contains', value: 'intent' }],
      NO_SCHEMA_DIR
    );
    expect(allPassed).toBe(true);
    expect(results[0].passed).toBe(true);
  });

  it('is case-insensitive', async () => {
    const { allPassed } = await runAssertions(
      'POSITIVE sentiment detected',
      [{ type: 'contains', value: 'positive' }],
      NO_SCHEMA_DIR
    );
    expect(allPassed).toBe(true);
  });

  it('fails when output does not contain value', async () => {
    const { results, allPassed } = await runAssertions(
      'No useful content here',
      [{ type: 'contains', value: 'intent' }],
      NO_SCHEMA_DIR
    );
    expect(allPassed).toBe(false);
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('intent');
  });

  it('fails gracefully with missing value', async () => {
    const { results } = await runAssertions(
      'any output',
      [{ type: 'contains' }],
      NO_SCHEMA_DIR
    );
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('value');
  });
});

describe('not_contains assertion', () => {
  it('passes when output does not contain value', async () => {
    const { allPassed } = await runAssertions(
      'I would be happy to help you with that.',
      [{ type: 'not_contains', value: 'I cannot help' }],
      NO_SCHEMA_DIR
    );
    expect(allPassed).toBe(true);
  });

  it('fails when output contains the forbidden value', async () => {
    const { results, allPassed } = await runAssertions(
      'I cannot help with that request.',
      [{ type: 'not_contains', value: 'I cannot help' }],
      NO_SCHEMA_DIR
    );
    expect(allPassed).toBe(false);
    expect(results[0].message).toContain('NOT to contain');
  });
});

describe('regex assertion', () => {
  it('passes when output matches pattern', async () => {
    const { allPassed } = await runAssertions(
      '{"sentiment": "positive", "confidence": 0.95}',
      [{ type: 'regex', value: '"sentiment":\\s*"(positive|negative|neutral)"' }],
      NO_SCHEMA_DIR
    );
    expect(allPassed).toBe(true);
  });

  it('fails when output does not match pattern', async () => {
    const { results, allPassed } = await runAssertions(
      '{"sentiment": "very happy"}',
      [{ type: 'regex', value: '"sentiment":\\s*"(positive|negative|neutral)"' }],
      NO_SCHEMA_DIR
    );
    expect(allPassed).toBe(false);
    expect(results[0].message).toContain('did not match');
  });

  it('fails gracefully with invalid regex', async () => {
    const { results } = await runAssertions(
      'some output',
      [{ type: 'regex', value: '[invalid regex(' }],
      NO_SCHEMA_DIR
    );
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('Invalid regex');
  });
});

describe('json_schema assertion', () => {
  it('passes when output matches schema', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepproof-test-'));
    const schemaPath = path.join(tmpDir, 'sentiment.json');
    fs.writeFileSync(schemaPath, JSON.stringify({
      type: 'object',
      required: ['sentiment', 'confidence'],
      properties: {
        sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    }));

    const { allPassed } = await runAssertions(
      '{"sentiment": "positive", "confidence": 0.95}',
      [{ type: 'json_schema', schema: 'sentiment.json' }],
      tmpDir
    );
    expect(allPassed).toBe(true);
  });

  it('fails when output does not match schema', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepproof-test-'));
    const schemaPath = path.join(tmpDir, 'sentiment.json');
    fs.writeFileSync(schemaPath, JSON.stringify({
      type: 'object',
      required: ['sentiment'],
      properties: {
        sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
      },
    }));

    const { results, allPassed } = await runAssertions(
      '{"sentiment": "very positive"}',
      [{ type: 'json_schema', schema: 'sentiment.json' }],
      tmpDir
    );
    expect(allPassed).toBe(false);
    expect(results[0].message).toContain('Schema validation failed');
  });

  it('fails when output is not valid JSON', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepproof-test-'));
    fs.writeFileSync(path.join(tmpDir, 'schema.json'), JSON.stringify({ type: 'object' }));

    const { results } = await runAssertions(
      'not json at all',
      [{ type: 'json_schema', schema: 'schema.json' }],
      tmpDir
    );
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('not valid JSON');
  });
});

describe('multiple assertions', () => {
  it('allPassed is false if any assertion fails', async () => {
    const { results, allPassed } = await runAssertions(
      '{"sentiment": "positive"}',
      [
        { type: 'contains', value: 'sentiment' },
        { type: 'contains', value: 'confidence' },
      ],
      NO_SCHEMA_DIR
    );
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
    expect(allPassed).toBe(false);
  });

  it('allPassed is true when all assertions pass', async () => {
    const { allPassed } = await runAssertions(
      '{"sentiment": "positive", "confidence": 0.9}',
      [
        { type: 'contains', value: 'sentiment' },
        { type: 'contains', value: 'confidence' },
        { type: 'not_contains', value: 'error' },
      ],
      NO_SCHEMA_DIR
    );
    expect(allPassed).toBe(true);
  });
});

describe('unknown assertion type', () => {
  it('fails gracefully', async () => {
    const { results } = await runAssertions(
      'some output',
      [{ type: 'unknown_type' as any }],
      NO_SCHEMA_DIR
    );
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('Unknown assertion type');
  });
});
