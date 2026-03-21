/**
 * Unit tests for core grading logic — pass rate computation and threshold boundaries.
 * These test the aggregation math in scenario-runner, not the AI adapter calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the adapter so tests never make real API calls
vi.mock('../../src/adapters/index.js', () => ({
  getAdapter: vi.fn(),
}));

import { getAdapter } from '../../src/adapters/index.js';
import { runScenario } from '../../src/core/scenario-runner.js';
import type { Scenario } from '../../src/core/types.js';

const FAKE_SCENARIO_PATH = '/fake/scenario.yaml';

function makeScenario(minPassRate: number, stepCount = 1): Scenario {
  return {
    name: 'grading-test',
    iterations: 5,
    variables: {},
    steps: Array.from({ length: stepCount }, (_, i) => ({
      id: `step-${i + 1}`,
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      prompt: 'Say hello',
      min_pass_rate: minPassRate,
      assertions: [{ type: 'contains', value: 'hello' }],
    })),
  };
}

describe('pass rate — boundary conditions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('exactly at threshold (4/5 = 0.80) is NOT below threshold — gate passes', async () => {
    // 5 iterations: 4 pass ("hello world"), 1 fails ("goodbye")
    let callCount = 0;
    (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue({
      call: async () => {
        callCount++;
        return callCount <= 4 ? 'hello world' : 'goodbye';
      },
    });

    const scenario = makeScenario(0.8);
    scenario.iterations = 5;
    const report = await runScenario(scenario, FAKE_SCENARIO_PATH);

    expect(report.steps[0].passRate).toBe(0.8);
    expect(report.steps[0].belowThreshold).toBe(false); // 0.8 is NOT < 0.8
    expect(report.allPassed).toBe(true);
  });

  it('one below threshold (3/5 = 0.60 < 0.80) → allPassed is false — CI gate fires', async () => {
    // 5 iterations: 3 pass, 2 fail
    let callCount = 0;
    (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue({
      call: async () => {
        callCount++;
        return callCount <= 3 ? 'hello world' : 'goodbye';
      },
    });

    const scenario = makeScenario(0.8);
    scenario.iterations = 5;
    const report = await runScenario(scenario, FAKE_SCENARIO_PATH);

    expect(report.steps[0].passRate).toBeCloseTo(0.6);
    expect(report.steps[0].belowThreshold).toBe(true);
    expect(report.allPassed).toBe(false);
  });

  it('min_pass_rate = 1.0 (strict) — one failure out of 10 fails the gate', async () => {
    // 10 iterations: 9 pass, 1 fails → passRate 0.9 < 1.0
    let callCount = 0;
    (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue({
      call: async () => {
        callCount++;
        return callCount < 10 ? 'hello world' : 'goodbye';
      },
    });

    const scenario = makeScenario(1.0);
    scenario.iterations = 10;
    const report = await runScenario(scenario, FAKE_SCENARIO_PATH);

    expect(report.steps[0].passes).toBe(9);
    expect(report.steps[0].failures).toBe(1);
    expect(report.steps[0].belowThreshold).toBe(true);
    expect(report.allPassed).toBe(false);
  });
});
