import * as path from 'node:path';
import { getAdapter } from '../adapters/index.js';
import type { AdapterResponse, ChatMessage } from '../adapters/base.js';
import { runAssertions } from '../assertions/engine.js';
import { substituteVariables } from './scenario-parser.js';
import { getCached, setCache } from '../cache.js';
import type { Scenario, ScenarioReport, Step, StepResult, StepSummary, DatasetRowSummary } from './types.js';

// Approximate cost per 1K tokens by model
const COST_PER_1K: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
  'claude-sonnet-4-6-20260401': { input: 0.003, output: 0.015 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
};

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = COST_PER_1K[model];
  if (!pricing) return 0;
  return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
}

export interface CacheStats {
  hits: number;
  misses: number;
}

export interface RunOptions {
  /** Override iterations from scenario file */
  iterations?: number;
  /** Called after each iteration completes */
  onIterationComplete?: (iteration: number, total: number) => void;
  /** Called after each step within an iteration */
  onStepComplete?: (stepId: string, passed: boolean) => void;
  /** Disable LLM response caching */
  noCache?: boolean;
  /** Populated after run — cache hit/miss stats */
  cacheStats?: CacheStats;
  /** Dataset rows — each row's columns become variables (merged with scenario variables, row wins) */
  dataset?: Array<Record<string, string>>;
  /** Original dataset file path (for reporting) */
  datasetPath?: string;
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Dependency graph helpers ──────────────────────────────────────────

/** Extract all {{step_id.output}} references from a string. O(n) in string length. */
function extractOutputRefs(text: string): string[] {
  const refs: string[] = [];
  const regex = /\{\{(\w+)\.output\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

/** Collect all step IDs referenced by a step (from prompt, conversation, system, if condition). */
function getImplicitDependencies(step: Step): string[] {
  const refs = new Set<string>();
  if (step.prompt) for (const r of extractOutputRefs(step.prompt)) refs.add(r);
  if (step.system) for (const r of extractOutputRefs(step.system)) refs.add(r);
  if (step.conversation) {
    for (const turn of step.conversation) {
      if (turn.content) for (const r of extractOutputRefs(turn.content)) refs.add(r);
    }
  }
  if (step.if) for (const r of extractOutputRefs(step.if)) refs.add(r);
  return Array.from(refs);
}

/**
 * Build full dependency set per step (explicit depends_on + implicit template refs).
 * O(S * T) where S = steps, T = max template refs per step.
 */
function buildDependencyMap(steps: Step[]): Map<string, Set<string>> {
  const stepIds = new Set(steps.map(s => s.id));
  const deps = new Map<string, Set<string>>();

  for (const step of steps) {
    const stepDeps = new Set<string>();
    if (step.depends_on) {
      for (const dep of step.depends_on) {
        if (!stepIds.has(dep)) {
          throw new Error(`Step "${step.id}" depends_on unknown step "${dep}"`);
        }
        stepDeps.add(dep);
      }
    }
    for (const ref of getImplicitDependencies(step)) {
      if (stepIds.has(ref)) stepDeps.add(ref);
    }
    deps.set(step.id, stepDeps);
  }
  return deps;
}

/** Check whether any parallelism exists in the dependency graph. */
function hasAnyParallelism(steps: Step[], depMap: Map<string, Set<string>>): boolean {
  // If any step has explicit deps/if/conversation, use the parallel executor
  if (steps.some(s => s.if || s.conversation)) return true;
  // If >1 step has zero deps they can run concurrently
  let zeroDeps = 0;
  for (const deps of depMap.values()) {
    if (deps.size === 0) zeroDeps++;
    if (zeroDeps > 1) return true;
  }
  return false;
}

// ── Conditional step evaluation ──────────────────────────────────────

/**
 * Evaluate an `if` condition string against step outputs.
 * Format: '<subject> contains|not_contains|matches "<value>"'
 * Subject is typically "{{step_id.output}}" which gets substituted first.
 */
function evaluateCondition(
  condition: string,
  variables: Record<string, string>,
  stepOutputs: Record<string, string>
): boolean {
  const resolved = substituteVariables(condition, variables, stepOutputs);

  const opMatch = resolved.match(/^(.+?)\s+(contains|not_contains|matches)\s+"(.*)"$/s);
  if (!opMatch) {
    throw new Error(
      `Invalid if condition: ${condition}. Expected: '<expr> contains|not_contains|matches "<value>"'`
    );
  }

  let subject = opMatch[1].trim();
  const operator = opMatch[2];
  const value = opMatch[3];

  // Strip surrounding quotes from subject if present
  if ((subject.startsWith('"') && subject.endsWith('"')) ||
      (subject.startsWith("'") && subject.endsWith("'"))) {
    subject = subject.slice(1, -1);
  }

  switch (operator) {
    case 'contains':    return subject.includes(value);
    case 'not_contains': return !subject.includes(value);
    case 'matches':     return new RegExp(value).test(subject);
    default:            return false;
  }
}

// ── Multi-turn conversation execution ────────────────────────────────

/**
 * Execute a multi-turn conversation step.
 * Builds messages from conversation turns, substituting templates.
 * The last assistant turn without content is the LLM generation point.
 */
async function executeConversation(
  step: Step,
  variables: Record<string, string>,
  stepOutputs: Record<string, string>,
  resolvedSystem: string | undefined,
  useCache: boolean,
  cacheStats: CacheStats
): Promise<AdapterResponse> {
  const turns = step.conversation!;
  const messages: ChatMessage[] = [];

  for (const turn of turns) {
    if (turn.content !== undefined) {
      const resolvedContent = substituteVariables(turn.content, variables, stepOutputs);
      messages.push({ role: turn.role, content: resolvedContent });
    } else if (turn.role === 'assistant') {
      // LLM generation point — stop building messages here
      break;
    }
  }

  // Cache key: concatenation of all messages + system
  const cacheKeyStr = messages.map(m => `${m.role}:${m.content}`).join('|');
  const cached: AdapterResponse | null = useCache
    ? getCached(step.provider, step.model, cacheKeyStr, resolvedSystem)
    : null;

  if (cached !== null) {
    cacheStats.hits++;
    return cached;
  }

  const adapter = getAdapter(step.provider, step.model);
  const response = await adapter.chat(messages, resolvedSystem);
  cacheStats.misses++;

  if (useCache) {
    setCache(step.provider, step.model, cacheKeyStr, resolvedSystem, response);
  }

  return response;
}

// ── Single step execution (with retry) ───────────────────────────────

/**
 * Run a single step for one iteration: conditional check, adapter call (prompt or conversation),
 * assertions, and retries.
 */
async function runStepIteration(
  step: Step,
  iteration: number,
  variables: Record<string, string>,
  stepOutputs: Record<string, string>,
  scenarioDir: string,
  useCache: boolean,
  cacheStats: CacheStats,
  datasetRow?: number,
): Promise<StepResult> {
  // Conditional: evaluate `if` and skip when false
  if (step.if) {
    const conditionMet = evaluateCondition(step.if, variables, stepOutputs);
    if (!conditionMet) {
      stepOutputs[step.id] = '';
      return {
        stepId: step.id,
        iteration,
        output: '',
        passed: true,
        skipped: true,
        assertionResults: [],
        durationMs: 0,
        datasetRow,
      };
    }
  }

  const maxRetries = step.retry ?? 0;
  const retryDelayVal = step.retry_delay ?? 1000;
  let retriesUsed = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resolvedSystem = step.system
      ? substituteVariables(step.system, variables, stepOutputs)
      : undefined;

    let output = '';
    let error: string | undefined;
    let durationMs = 0;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let costUsd: number | undefined;

    try {
      let response: AdapterResponse;

      if (step.conversation) {
        // Multi-turn conversation mode
        response = await executeConversation(step, variables, stepOutputs, resolvedSystem, useCache, cacheStats);
      } else {
        // Standard single-prompt mode
        const resolvedPrompt = substituteVariables(step.prompt ?? '', variables, stepOutputs);

        const cached: AdapterResponse | null = useCache
          ? getCached(step.provider, step.model, resolvedPrompt, resolvedSystem)
          : null;

        if (cached !== null) {
          cacheStats.hits++;
          response = cached;
        } else {
          const adapter = getAdapter(step.provider, step.model);
          response = await adapter.call(resolvedPrompt, resolvedSystem);
          cacheStats.misses++;
          if (useCache && attempt === 0) {
            setCache(step.provider, step.model, resolvedPrompt, resolvedSystem, response);
          }
        }
      }

      output = response.text;
      durationMs = response.durationMs;
      if (response.usage) {
        inputTokens = response.usage.inputTokens;
        outputTokens = response.usage.outputTokens;
        costUsd = calculateCost(step.model, inputTokens, outputTokens);
      }
      stepOutputs[step.id] = output;
    } catch (e) {
      error = (e as Error).message;
      cacheStats.misses++;
      stepOutputs[step.id] = '';
    }

    let assertionResults: { type: string; passed: boolean; message?: string }[] = [];
    let assertionsPassed = false;

    if (!error) {
      const { results, allPassed } = await runAssertions(
        output,
        step.assertions,
        scenarioDir,
        { durationMs, costUsd }
      );
      assertionResults = results;
      assertionsPassed = allPassed;
    }

    const stepPassed = !error && assertionsPassed;

    if (stepPassed || attempt === maxRetries) {
      return {
        stepId: step.id,
        iteration,
        output,
        passed: stepPassed,
        retriesUsed,
        datasetRow,
        assertionResults,
        error,
        durationMs,
        inputTokens,
        outputTokens,
        costUsd,
      };
    }

    retriesUsed++;
    if (retryDelayVal > 0) await delayMs(retryDelayVal);
  }

  // Unreachable
  throw new Error('Unreachable');
}

// ── Parallel step execution (topological) ────────────────────────────

/**
 * Execute steps respecting dependency graph.
 * Steps with all dependencies satisfied run concurrently via Promise.all().
 * O(S^2) worst case (fully serial chain) — S is typically < 20.
 */
async function executeStepsParallel(
  steps: Step[],
  depMap: Map<string, Set<string>>,
  variables: Record<string, string>,
  scenarioDir: string,
  iteration: number,
  useCache: boolean,
  cacheStats: CacheStats,
  onStepComplete?: (stepId: string, passed: boolean) => void,
  datasetRow?: number,
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const stepOutputs: Record<string, string> = {};
  const completed = new Set<string>();
  const remaining = new Set(steps.map(s => s.id));
  const stepById = new Map(steps.map(s => [s.id, s]));

  while (remaining.size > 0) {
    // Find steps whose dependencies are all satisfied
    const ready: Step[] = [];
    for (const id of remaining) {
      const deps = depMap.get(id)!;
      let allMet = true;
      for (const dep of deps) {
        if (!completed.has(dep)) { allMet = false; break; }
      }
      if (allMet) ready.push(stepById.get(id)!);
    }

    if (ready.length === 0) {
      throw new Error(`Circular dependency detected among steps: ${Array.from(remaining).join(', ')}`);
    }

    const batchResults = await Promise.all(
      ready.map(step =>
        runStepIteration(step, iteration, variables, stepOutputs, scenarioDir, useCache, cacheStats, datasetRow)
      )
    );

    for (const result of batchResults) {
      results.push(result);
      completed.add(result.stepId);
      remaining.delete(result.stepId);
      onStepComplete?.(result.stepId, result.passed);
    }
  }

  return results;
}

// ── Main entry point ─────────────────────────────────────────────────

export async function runScenario(
  scenario: Scenario,
  scenarioFilePath: string,
  options: RunOptions = {}
): Promise<ScenarioReport> {
  const iterations = options.iterations ?? scenario.iterations ?? 10;
  const scenarioDir = path.dirname(path.resolve(scenarioFilePath));
  const baseVariables = scenario.variables ?? {};
  const dataset = options.dataset;

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const allResults: StepResult[] = [];
  const useCache = !options.noCache;
  const cacheStats: CacheStats = { hits: 0, misses: 0 };

  // Build dependency graph once
  const depMap = buildDependencyMap(scenario.steps);
  const useParallel = hasAnyParallelism(scenario.steps, depMap);

  // Variable sets: one per dataset row, or just base variables
  const variableSets: Array<{ vars: Record<string, string>; rowIndex?: number }> = dataset
    ? dataset.map((row, i) => ({ vars: { ...baseVariables, ...row }, rowIndex: i }))
    : [{ vars: baseVariables }];

  for (const { vars, rowIndex } of variableSets) {
    for (let i = 1; i <= iterations; i++) {
      let iterResults: StepResult[];

      if (useParallel) {
        iterResults = await executeStepsParallel(
          scenario.steps, depMap, vars, scenarioDir, i, useCache, cacheStats,
          options.onStepComplete, rowIndex
        );
      } else {
        // Fast sequential path for simple scenarios
        const stepOutputs: Record<string, string> = {};
        iterResults = [];
        for (const step of scenario.steps) {
          const result = await runStepIteration(
            step, i, vars, stepOutputs, scenarioDir, useCache, cacheStats, rowIndex
          );
          iterResults.push(result);
          options.onStepComplete?.(step.id, result.passed);
        }
      }

      allResults.push(...iterResults);
      options.onIterationComplete?.(
        dataset ? (rowIndex! * iterations) + i : i,
        dataset ? dataset.length * iterations : iterations
      );
    }
  }

  // Aggregate per-step summaries (exclude skipped from pass/fail counts)
  const steps: StepSummary[] = scenario.steps.map((step) => {
    const stepResults = allResults.filter((r) => r.stepId === step.id);
    const nonSkipped = stepResults.filter(r => !r.skipped);
    const passes = nonSkipped.filter((r) => r.passed).length;
    const failures = nonSkipped.length - passes;
    const passRate = nonSkipped.length > 0 ? passes / nonSkipped.length : 1; // all-skipped = pass
    const minPassRate = step.min_pass_rate ?? 0.8;
    const retriedCount = stepResults.filter((r) => (r.retriesUsed ?? 0) > 0).length;

    const totalDurationMs = stepResults.reduce((s, r) => s + r.durationMs, 0);
    const avgDurationMs = stepResults.length > 0 ? totalDurationMs / stepResults.length : 0;
    const totalCostUsd = stepResults.reduce((s, r) => s + (r.costUsd ?? 0), 0);
    const avgCostUsd = stepResults.length > 0 ? totalCostUsd / stepResults.length : 0;

    return {
      stepId: step.id,
      totalRuns: stepResults.length,
      passes,
      failures,
      passRate,
      minPassRate,
      belowThreshold: passRate < minPassRate,
      avgDurationMs,
      totalCostUsd,
      avgCostUsd,
      retriedCount: retriedCount > 0 ? retriedCount : undefined,
    };
  });

  const allPassed = steps.every((s) => !s.belowThreshold);
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  // Build dataset summary if applicable
  let datasetInfo: ScenarioReport['dataset'];
  if (dataset && options.datasetPath) {
    const rowSummaries: DatasetRowSummary[] = dataset.map((row, rowIdx) => {
      const rowResults = allResults.filter((r) => r.datasetRow === rowIdx);
      const stepSummaries = scenario.steps.map((step) => {
        const sr = rowResults.filter((r) => r.stepId === step.id);
        const passed = sr.filter((r) => r.passed).length;
        return {
          stepId: step.id,
          passed: passed === sr.length,
          passRate: sr.length > 0 ? passed / sr.length : 0,
        };
      });
      const keys = Object.keys(row).slice(0, 3);
      const preview: Record<string, string> = {};
      for (const k of keys) preview[k] = row[k];

      return {
        rowIndex: rowIdx,
        rowPreview: preview,
        allStepsPassed: stepSummaries.every((s) => s.passed),
        stepResults: stepSummaries,
      };
    });

    datasetInfo = {
      path: options.datasetPath,
      totalRows: dataset.length,
      rowsPassed: rowSummaries.filter((r) => r.allStepsPassed).length,
      rowSummaries,
    };
  }

  options.cacheStats = cacheStats;

  return {
    scenarioName: scenario.name,
    iterations,
    startedAt,
    completedAt,
    durationMs,
    steps,
    allPassed,
    results: allResults,
    dataset: datasetInfo,
  };
}
