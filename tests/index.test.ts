import { describe, it, expect } from 'vitest';
import { formatSarif } from '../src/reporters/sarif-reporter.js';
import { formatJunit } from '../src/reporters/junit-reporter.js';
import type { ScenarioReport } from '../src/core/types.js';

function makeReport(overrides: Partial<ScenarioReport> = {}): ScenarioReport {
  return {
    scenarioName: 'test-scenario',
    iterations: 5,
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:00:10.000Z',
    durationMs: 10000,
    allPassed: true,
    steps: [
      {
        stepId: 'step-one',
        totalRuns: 5,
        passes: 5,
        failures: 0,
        passRate: 1.0,
        minPassRate: 0.8,
        belowThreshold: false,
      },
    ],
    results: [],
    ...overrides,
  };
}

function makeReportWithFailure(): ScenarioReport {
  return makeReport({
    allPassed: false,
    steps: [
      {
        stepId: 'step-passing',
        totalRuns: 5,
        passes: 5,
        failures: 0,
        passRate: 1.0,
        minPassRate: 0.8,
        belowThreshold: false,
      },
      {
        stepId: 'step-failing',
        totalRuns: 5,
        passes: 2,
        failures: 3,
        passRate: 0.4,
        minPassRate: 0.8,
        belowThreshold: true,
      },
    ],
  });
}

describe('formatSarif', () => {
  it('produces valid SARIF structure with version and runs', () => {
    const output = formatSarif(makeReport());
    const sarif = JSON.parse(output);

    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toContain('sarif-schema-2.1.0.json');
    expect(Array.isArray(sarif.runs)).toBe(true);
    expect(sarif.runs.length).toBe(1);
  });

  it('includes tool driver name and version', () => {
    const sarif = JSON.parse(formatSarif(makeReport()));
    const driver = sarif.runs[0].tool.driver;

    expect(driver.name).toBe('stepproof');
    expect(driver.version).toBe('0.1.0');
  });

  it('includes one rule per step', () => {
    const report = makeReport();
    const sarif = JSON.parse(formatSarif(report));
    const rules = sarif.runs[0].tool.driver.rules;

    expect(rules.length).toBe(report.steps.length);
    expect(rules[0].id).toBe('step-one');
    expect(rules[0].name).toBe('step-one');
  });

  it('includes results for all steps', () => {
    const sarif = JSON.parse(formatSarif(makeReport()));
    expect(Array.isArray(sarif.runs[0].results)).toBe(true);
    expect(sarif.runs[0].results.length).toBe(1);
  });

  it('passing step has level "none"', () => {
    const sarif = JSON.parse(formatSarif(makeReport()));
    const result = sarif.runs[0].results[0];

    expect(result.level).toBe('none');
    expect(result.ruleId).toBe('step-one');
  });

  it('failing step has level "error"', () => {
    const sarif = JSON.parse(formatSarif(makeReportWithFailure()));
    const results = sarif.runs[0].results;
    const failingResult = results.find((r: { ruleId: string }) => r.ruleId === 'step-failing');

    expect(failingResult).toBeDefined();
    expect(failingResult.level).toBe('error');
  });

  it('failing step message includes pass rate and threshold', () => {
    const sarif = JSON.parse(formatSarif(makeReportWithFailure()));
    const results = sarif.runs[0].results;
    const failingResult = results.find((r: { ruleId: string }) => r.ruleId === 'step-failing');

    expect(failingResult.message.text).toContain('40.0%');
    expect(failingResult.message.text).toContain('80%');
  });
});

describe('formatJunit', () => {
  it('produces XML with testsuites root element', () => {
    const output = formatJunit(makeReport());

    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(output).toContain('<testsuites');
    expect(output).toContain('</testsuites>');
  });

  it('includes testsuite with scenario name', () => {
    const output = formatJunit(makeReport());

    expect(output).toContain('<testsuite');
    expect(output).toContain('name="test-scenario"');
    expect(output).toContain('</testsuite>');
  });

  it('includes one testcase per step', () => {
    const output = formatJunit(makeReport());

    expect(output).toContain('<testcase');
    expect(output).toContain('name="step-one"');
    expect(output).toContain('classname="stepproof.steps"');
  });

  it('passing step has no failure element', () => {
    const output = formatJunit(makeReport());

    expect(output).not.toContain('<failure');
  });

  it('failing step gets a failure element', () => {
    const output = formatJunit(makeReportWithFailure());

    expect(output).toContain('<failure');
    expect(output).toContain('</failure>');
  });

  it('failing step failure message includes pass rate and threshold', () => {
    const output = formatJunit(makeReportWithFailure());

    expect(output).toContain('40.0%');
    expect(output).toContain('80%');
  });

  it('failure body includes iteration counts', () => {
    const output = formatJunit(makeReportWithFailure());

    expect(output).toContain('2/5');
  });

  it('testsuites counts reflect actual failures', () => {
    const output = formatJunit(makeReportWithFailure());

    expect(output).toContain('tests="2"');
    expect(output).toContain('failures="1"');
  });
});
