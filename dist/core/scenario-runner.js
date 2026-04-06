import * as path from 'node:path';
import { getAdapter, getCustomAdapter } from '../adapters/index.js';
import { runAssertions } from '../assertions/engine.js';
import { substituteVariables } from './scenario-parser.js';
import { getCached, setCache } from '../cache.js';
// Approximate cost per 1K tokens by model
const COST_PER_1K = {
    'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
    'claude-sonnet-4-6-20260401': { input: 0.003, output: 0.015 },
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
};
function calculateCost(model, inputTokens, outputTokens) {
    const pricing = COST_PER_1K[model];
    if (!pricing)
        return 0;
    return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
}
function delayMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Build CallOptions from step-level config fields */
function buildCallOptions(step) {
    if (step.temperature === undefined && step.top_p === undefined && step.max_tokens === undefined) {
        return undefined;
    }
    return {
        temperature: step.temperature,
        topP: step.top_p,
        maxTokens: step.max_tokens,
    };
}
/** Wrap a promise with a timeout using Promise.race */
function withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Step timed out after ${timeoutMs}ms`)), timeoutMs);
        promise.then((val) => { clearTimeout(timer); resolve(val); }, (err) => { clearTimeout(timer); reject(err); });
    });
}
// ── Streaming execution ─────────────────────────────────────────────
/**
 * Execute a step using streaming and collect TTFT/TPS/ITL metrics.
 * Falls back to non-streaming if the adapter doesn't support it.
 */
async function executeStreaming(step, resolvedPrompt, resolvedSystem, callOptions, scenarioDir) {
    const adapter = step.provider === 'custom' && step.plugin
        ? await getCustomAdapter(path.resolve(scenarioDir, step.plugin))
        : getAdapter(step.provider, step.model);
    if (!adapter.stream) {
        // Fallback: adapter doesn't support streaming
        return adapter.call(resolvedPrompt, resolvedSystem, callOptions);
    }
    const startMs = Date.now();
    const tokens = [];
    const timestamps = [];
    const gen = adapter.stream(resolvedPrompt, resolvedSystem, callOptions);
    for await (const chunk of gen) {
        tokens.push(chunk.token);
        timestamps.push(chunk.timestampMs);
    }
    const endMs = Date.now();
    const text = tokens.join('');
    const durationMs = endMs - startMs;
    // Compute stream metrics — O(n) single pass over timestamps
    let ttftMs = 0;
    let tokensPerSecond = 0;
    let interTokenLatencyMs = 0;
    if (timestamps.length > 0) {
        ttftMs = timestamps[0] - startMs;
        tokensPerSecond = durationMs > 0 ? (tokens.length / durationMs) * 1000 : 0;
        if (timestamps.length > 1) {
            let totalITL = 0;
            for (let i = 1; i < timestamps.length; i++) {
                totalITL += timestamps[i] - timestamps[i - 1];
            }
            interTokenLatencyMs = totalITL / (timestamps.length - 1);
        }
    }
    return {
        text,
        durationMs,
        streamMetrics: { ttftMs, tokensPerSecond, interTokenLatencyMs },
    };
}
// ── Dependency graph helpers ──────────────────────────────────────────
/** Extract all {{step_id.output}} references from a string. O(n) in string length. */
function extractOutputRefs(text) {
    const refs = [];
    const regex = /\{\{(\w+)\.output\}\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        refs.push(match[1]);
    }
    return refs;
}
/** Collect all step IDs referenced by a step (from prompt, conversation, system, if condition). */
function getImplicitDependencies(step) {
    const refs = new Set();
    if (step.prompt)
        for (const r of extractOutputRefs(step.prompt))
            refs.add(r);
    if (step.system)
        for (const r of extractOutputRefs(step.system))
            refs.add(r);
    if (step.conversation) {
        for (const turn of step.conversation) {
            if (turn.content)
                for (const r of extractOutputRefs(turn.content))
                    refs.add(r);
        }
    }
    if (step.if)
        for (const r of extractOutputRefs(step.if))
            refs.add(r);
    return Array.from(refs);
}
/**
 * Build full dependency set per step (explicit depends_on + implicit template refs).
 * O(S * T) where S = steps, T = max template refs per step.
 */
function buildDependencyMap(steps) {
    const stepIds = new Set(steps.map(s => s.id));
    const deps = new Map();
    for (const step of steps) {
        const stepDeps = new Set();
        if (step.depends_on) {
            for (const dep of step.depends_on) {
                if (!stepIds.has(dep)) {
                    throw new Error(`Step "${step.id}" depends_on unknown step "${dep}"`);
                }
                stepDeps.add(dep);
            }
        }
        for (const ref of getImplicitDependencies(step)) {
            if (stepIds.has(ref))
                stepDeps.add(ref);
        }
        deps.set(step.id, stepDeps);
    }
    return deps;
}
/** Check whether any parallelism exists in the dependency graph. */
function hasAnyParallelism(steps, depMap) {
    if (steps.some(s => s.if || s.conversation))
        return true;
    let zeroDeps = 0;
    for (const deps of depMap.values()) {
        if (deps.size === 0)
            zeroDeps++;
        if (zeroDeps > 1)
            return true;
    }
    return false;
}
// ── Conditional step evaluation ──────────────────────────────────────
function evaluateCondition(condition, variables, stepOutputs) {
    const resolved = substituteVariables(condition, variables, stepOutputs);
    const opMatch = resolved.match(/^(.+?)\s+(contains|not_contains|matches)\s+"(.*)"$/s);
    if (!opMatch) {
        throw new Error(`Invalid if condition: ${condition}. Expected: '<expr> contains|not_contains|matches "<value>"'`);
    }
    let subject = opMatch[1].trim();
    const operator = opMatch[2];
    const value = opMatch[3];
    if ((subject.startsWith('"') && subject.endsWith('"')) ||
        (subject.startsWith("'") && subject.endsWith("'"))) {
        subject = subject.slice(1, -1);
    }
    switch (operator) {
        case 'contains': return subject.includes(value);
        case 'not_contains': return !subject.includes(value);
        case 'matches': return new RegExp(value).test(subject);
        default: return false;
    }
}
// ── Multi-turn conversation execution ────────────────────────────────
async function executeConversation(step, variables, stepOutputs, resolvedSystem, useCache, cacheStats, scenarioDir) {
    const turns = step.conversation;
    const messages = [];
    for (const turn of turns) {
        if (turn.content !== undefined) {
            const resolvedContent = substituteVariables(turn.content, variables, stepOutputs);
            messages.push({ role: turn.role, content: resolvedContent });
        }
        else if (turn.role === 'assistant') {
            break;
        }
    }
    const cacheKeyStr = messages.map(m => `${m.role}:${m.content}`).join('|');
    const cached = useCache
        ? getCached(step.provider, step.model, cacheKeyStr, resolvedSystem)
        : null;
    if (cached !== null) {
        cacheStats.hits++;
        return cached;
    }
    const adapter = step.provider === 'custom' && step.plugin
        ? await getCustomAdapter(path.resolve(scenarioDir, step.plugin))
        : getAdapter(step.provider, step.model);
    const callOptions = buildCallOptions(step);
    const response = await adapter.chat(messages, resolvedSystem, callOptions);
    cacheStats.misses++;
    if (useCache) {
        setCache(step.provider, step.model, cacheKeyStr, resolvedSystem, response);
    }
    return response;
}
// ── Single step execution (with retry) ───────────────────────────────
async function runStepIteration(step, iteration, variables, stepOutputs, scenarioDir, useCache, cacheStats, datasetRow) {
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
    const callOptions = buildCallOptions(step);
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const resolvedSystem = step.system
            ? substituteVariables(step.system, variables, stepOutputs)
            : undefined;
        let output = '';
        let error;
        let durationMs = 0;
        let inputTokens;
        let outputTokens;
        let costUsd;
        let streamMetrics;
        try {
            let response;
            let callPromise;
            if (step.conversation) {
                callPromise = executeConversation(step, variables, stepOutputs, resolvedSystem, useCache, cacheStats, scenarioDir);
            }
            else if (step.stream) {
                // Streaming mode — bypass cache, collect stream metrics
                const resolvedPrompt = substituteVariables(step.prompt ?? '', variables, stepOutputs);
                callPromise = executeStreaming(step, resolvedPrompt, resolvedSystem, callOptions, scenarioDir);
                cacheStats.misses++;
            }
            else {
                // Standard single-prompt mode
                const resolvedPrompt = substituteVariables(step.prompt ?? '', variables, stepOutputs);
                const cached = useCache
                    ? getCached(step.provider, step.model, resolvedPrompt, resolvedSystem)
                    : null;
                if (cached !== null) {
                    cacheStats.hits++;
                    callPromise = Promise.resolve(cached);
                }
                else {
                    const adapter = step.provider === 'custom' && step.plugin
                        ? await getCustomAdapter(path.resolve(scenarioDir, step.plugin))
                        : getAdapter(step.provider, step.model);
                    callPromise = adapter.call(resolvedPrompt, resolvedSystem, callOptions).then(resp => {
                        cacheStats.misses++;
                        if (useCache && attempt === 0) {
                            setCache(step.provider, step.model, resolvedPrompt, resolvedSystem, resp);
                        }
                        return resp;
                    });
                }
            }
            // Apply timeout if configured
            if (step.timeout) {
                response = await withTimeout(callPromise, step.timeout);
            }
            else {
                response = await callPromise;
            }
            output = response.text;
            durationMs = response.durationMs;
            streamMetrics = response.streamMetrics;
            if (response.usage) {
                inputTokens = response.usage.inputTokens;
                outputTokens = response.usage.outputTokens;
                costUsd = calculateCost(step.model, inputTokens, outputTokens);
            }
            stepOutputs[step.id] = output;
        }
        catch (e) {
            error = e.message;
            cacheStats.misses++;
            stepOutputs[step.id] = '';
        }
        let assertionResults = [];
        let assertionsPassed = false;
        if (!error) {
            const { results, allPassed } = await runAssertions(output, step.assertions, scenarioDir, { durationMs, costUsd, streamMetrics, scenarioName: '', stepId: step.id });
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
                streamMetrics,
            };
        }
        retriesUsed++;
        if (retryDelayVal > 0)
            await delayMs(retryDelayVal);
    }
    // Unreachable
    throw new Error('Unreachable');
}
// ── Parallel step execution (topological) ────────────────────────────
async function executeStepsParallel(steps, depMap, variables, scenarioDir, iteration, useCache, cacheStats, onStepComplete, datasetRow) {
    const results = [];
    const stepOutputs = {};
    const completed = new Set();
    const remaining = new Set(steps.map(s => s.id));
    const stepById = new Map(steps.map(s => [s.id, s]));
    while (remaining.size > 0) {
        const ready = [];
        for (const id of remaining) {
            const deps = depMap.get(id);
            let allMet = true;
            for (const dep of deps) {
                if (!completed.has(dep)) {
                    allMet = false;
                    break;
                }
            }
            if (allMet)
                ready.push(stepById.get(id));
        }
        if (ready.length === 0) {
            throw new Error(`Circular dependency detected among steps: ${Array.from(remaining).join(', ')}`);
        }
        const batchResults = await Promise.all(ready.map(step => runStepIteration(step, iteration, variables, stepOutputs, scenarioDir, useCache, cacheStats, datasetRow)));
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
export async function runScenario(scenario, scenarioFilePath, options = {}) {
    const iterations = options.iterations ?? scenario.iterations ?? 10;
    const scenarioDir = path.dirname(path.resolve(scenarioFilePath));
    const baseVariables = scenario.variables ?? {};
    const dataset = options.dataset;
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const allResults = [];
    const useCache = !options.noCache;
    const cacheStats = { hits: 0, misses: 0 };
    // Build dependency graph once
    const depMap = buildDependencyMap(scenario.steps);
    const useParallel = hasAnyParallelism(scenario.steps, depMap);
    // Variable sets: one per dataset row, or just base variables
    const variableSets = dataset
        ? dataset.map((row, i) => ({ vars: { ...baseVariables, ...row }, rowIndex: i }))
        : [{ vars: baseVariables }];
    for (const { vars, rowIndex } of variableSets) {
        for (let i = 1; i <= iterations; i++) {
            let iterResults;
            if (useParallel) {
                iterResults = await executeStepsParallel(scenario.steps, depMap, vars, scenarioDir, i, useCache, cacheStats, options.onStepComplete, rowIndex);
            }
            else {
                const stepOutputs = {};
                iterResults = [];
                for (const step of scenario.steps) {
                    const result = await runStepIteration(step, i, vars, stepOutputs, scenarioDir, useCache, cacheStats, rowIndex);
                    iterResults.push(result);
                    options.onStepComplete?.(step.id, result.passed);
                }
            }
            allResults.push(...iterResults);
            options.onIterationComplete?.(dataset ? (rowIndex * iterations) + i : i, dataset ? dataset.length * iterations : iterations);
        }
    }
    // Aggregate per-step summaries (exclude skipped from pass/fail counts)
    const steps = scenario.steps.map((step) => {
        const stepResults = allResults.filter((r) => r.stepId === step.id);
        const nonSkipped = stepResults.filter(r => !r.skipped);
        const passes = nonSkipped.filter((r) => r.passed).length;
        const failures = nonSkipped.length - passes;
        const passRate = nonSkipped.length > 0 ? passes / nonSkipped.length : 1;
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
    let datasetInfo;
    if (dataset && options.datasetPath) {
        const rowSummaries = dataset.map((row, rowIdx) => {
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
            const preview = {};
            for (const k of keys)
                preview[k] = row[k];
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
//# sourceMappingURL=scenario-runner.js.map