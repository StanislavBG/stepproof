import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScenario } from '../../src/core/scenario-runner.js';
import type { Scenario } from '../../src/core/types.js';

// Mock the adapters module so no real API calls are made
vi.mock('../../src/adapters/index.js', () => ({
  getAdapter: vi.fn(),
}));

import { getAdapter } from '../../src/adapters/index.js';
const mockGetAdapter = vi.mocked(getAdapter);

const FIXTURE_PATH = '/tmp/fake-scenario.yaml';

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'Test Scenario',
    iterations: 3,
    variables: {},
    steps: [
      {
        id: 'step_one',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        prompt: 'Say hello',
        min_pass_rate: 0.8,
        assertions: [{ type: 'contains', value: 'hello' }],
      },
    ],
    ...overrides,
  };
}

function mockAdapter(response: string) {
  mockGetAdapter.mockReturnValue({
    call: vi.fn().mockResolvedValue(response),
  } as any);
}

function mockAdapterError(message: string) {
  mockGetAdapter.mockReturnValue({
    call: vi.fn().mockRejectedValue(new Error(message)),
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runScenario — iteration counting', () => {
  it('runs exactly the configured number of iterations', async () => {
    mockAdapter('hello world');
    const scenario = makeScenario({ iterations: 5 });
    const report = await runScenario(scenario, FIXTURE_PATH);
    expect(report.iterations).toBe(5);
    expect(report.results).toHaveLength(5); // 5 iterations × 1 step
  });

  it('respects iterations override from options', async () => {
    mockAdapter('hello world');
    const scenario = makeScenario({ iterations: 10 });
    const report = await runScenario(scenario, FIXTURE_PATH, { iterations: 2 });
    expect(report.iterations).toBe(2);
    expect(report.results).toHaveLength(2);
  });

  it('defaults to scenario.iterations when no override given', async () => {
    mockAdapter('hello world');
    const scenario = makeScenario({ iterations: 4 });
    const report = await runScenario(scenario, FIXTURE_PATH);
    expect(report.iterations).toBe(4);
  });

  it('calls onIterationComplete callback for each iteration', async () => {
    mockAdapter('hello world');
    const scenario = makeScenario({ iterations: 3 });
    const calls: [number, number][] = [];
    await runScenario(scenario, FIXTURE_PATH, {
      onIterationComplete: (i, total) => calls.push([i, total]),
    });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual([1, 3]);
    expect(calls[2]).toEqual([3, 3]);
  });
});

describe('runScenario — pass/fail aggregation', () => {
  it('allPassed is true when all steps clear their threshold', async () => {
    mockAdapter('hello world');
    const scenario = makeScenario({
      iterations: 5,
      steps: [{
        id: 'step_one',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        prompt: 'Say hello',
        min_pass_rate: 0.8,
        assertions: [{ type: 'contains', value: 'hello' }],
      }],
    });
    const report = await runScenario(scenario, FIXTURE_PATH);
    expect(report.allPassed).toBe(true);
    expect(report.steps[0].belowThreshold).toBe(false);
  });

  it('allPassed is false when a step falls below threshold', async () => {
    let callCount = 0;
    mockGetAdapter.mockReturnValue({
      call: vi.fn().mockImplementation(async () => {
        callCount++;
        // Only 1 of 5 iterations returns "hello" (20% pass rate, threshold 0.8)
        return callCount === 1 ? 'hello world' : 'goodbye world';
      }),
    } as any);

    const scenario = makeScenario({
      iterations: 5,
      steps: [{
        id: 'step_one',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        prompt: 'Say hello',
        min_pass_rate: 0.8,
        assertions: [{ type: 'contains', value: 'hello' }],
      }],
    });
    const report = await runScenario(scenario, FIXTURE_PATH);
    expect(report.allPassed).toBe(false);
    expect(report.steps[0].belowThreshold).toBe(true);
    expect(report.steps[0].passes).toBe(1);
    expect(report.steps[0].failures).toBe(4);
  });

  it('step with min_pass_rate 0.0 always passes regardless of assertions', async () => {
    mockAdapter('no match here');
    const scenario = makeScenario({
      iterations: 3,
      steps: [{
        id: 'zero_threshold',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        prompt: 'Say hello',
        min_pass_rate: 0.0,
        assertions: [{ type: 'contains', value: 'hello' }],
      }],
    });
    const report = await runScenario(scenario, FIXTURE_PATH);
    // passRate is 0 but threshold is also 0 → belowThreshold is false
    expect(report.steps[0].belowThreshold).toBe(false);
    expect(report.allPassed).toBe(true);
  });
});

describe('runScenario — adapter error handling', () => {
  it('records error and marks step as failed when adapter throws', async () => {
    mockAdapterError('API rate limit exceeded');
    const scenario = makeScenario({ iterations: 2 });
    const report = await runScenario(scenario, FIXTURE_PATH);
    // Both iterations should fail with error
    expect(report.results[0].passed).toBe(false);
    expect(report.results[0].error).toBe('API rate limit exceeded');
    expect(report.results[1].passed).toBe(false);
    expect(report.allPassed).toBe(false);
  });

  it('does not run assertions when adapter errors', async () => {
    mockAdapterError('network failure');
    const scenario = makeScenario({ iterations: 1 });
    const report = await runScenario(scenario, FIXTURE_PATH);
    // assertionResults should be empty since adapter errored
    expect(report.results[0].assertionResults).toHaveLength(0);
  });

  it('continues to next iteration after per-step error', async () => {
    let callCount = 0;
    mockGetAdapter.mockReturnValue({
      call: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('transient error');
        return 'hello world';
      }),
    } as any);

    const scenario = makeScenario({ iterations: 3 });
    const report = await runScenario(scenario, FIXTURE_PATH);
    // 3 iterations ran despite first one erroring
    expect(report.results).toHaveLength(3);
    expect(report.results[0].error).toBe('transient error');
    expect(report.results[1].error).toBeUndefined();
    expect(report.results[2].error).toBeUndefined();
  });
});

describe('runScenario — report metadata', () => {
  it('report includes startedAt, completedAt, and durationMs', async () => {
    mockAdapter('hello');
    const scenario = makeScenario({ iterations: 1 });
    const report = await runScenario(scenario, FIXTURE_PATH);
    expect(report.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('report scenarioName matches the scenario', async () => {
    mockAdapter('hello');
    const scenario = makeScenario({ name: 'My Custom Scenario' });
    const report = await runScenario(scenario, FIXTURE_PATH);
    expect(report.scenarioName).toBe('My Custom Scenario');
  });

  it('step summaries include accurate pass/fail counts', async () => {
    let callCount = 0;
    mockGetAdapter.mockReturnValue({
      call: vi.fn().mockImplementation(async () => {
        callCount++;
        return callCount <= 3 ? 'hello world' : 'no match';
      }),
    } as any);

    const scenario = makeScenario({ iterations: 5 });
    const report = await runScenario(scenario, FIXTURE_PATH);
    const step = report.steps[0];
    expect(step.totalRuns).toBe(5);
    expect(step.passes).toBe(3);
    expect(step.failures).toBe(2);
    expect(step.passRate).toBeCloseTo(0.6);
  });
});

describe('runScenario — multi-step scenarios', () => {
  it('runs all steps in each iteration', async () => {
    const calls: string[] = [];
    mockGetAdapter.mockImplementation((provider: string, model: string) => ({
      call: vi.fn().mockImplementation(async (prompt: string) => {
        calls.push(prompt);
        return 'hello world';
      }),
    } as any));

    const scenario = makeScenario({
      iterations: 2,
      steps: [
        {
          id: 'first',
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          prompt: 'prompt-A',
          min_pass_rate: 0.8,
          assertions: [],
        },
        {
          id: 'second',
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          prompt: 'prompt-B',
          min_pass_rate: 0.8,
          assertions: [],
        },
      ],
    });
    const report = await runScenario(scenario, FIXTURE_PATH);
    // 2 iterations × 2 steps = 4 calls total
    expect(report.results).toHaveLength(4);
    expect(calls).toHaveLength(4);
    // Steps alternate: A, B, A, B
    expect(calls[0]).toBe('prompt-A');
    expect(calls[1]).toBe('prompt-B');
    expect(calls[2]).toBe('prompt-A');
    expect(calls[3]).toBe('prompt-B');
  });
});
