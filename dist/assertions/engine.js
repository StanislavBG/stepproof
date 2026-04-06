import * as fs from 'node:fs';
import * as path from 'node:path';
import { Ajv as AjvClass } from 'ajv';
import { getAdapter } from '../adapters/index.js';
const ajv = new AjvClass({ allErrors: true });
export async function runAssertions(output, assertions, scenarioDir, ctx = {}) {
    const results = [];
    for (const assertion of assertions) {
        const result = await runAssertion(output, assertion, scenarioDir, ctx);
        results.push(result);
    }
    const allPassed = results.every((r) => r.passed);
    return { results, allPassed };
}
async function runAssertion(output, assertion, scenarioDir, ctx) {
    const { type } = assertion;
    switch (type) {
        case 'contains': {
            if (!assertion.value) {
                return fail(type, 'Missing required field "value"');
            }
            const val = String(assertion.value);
            const passed = output.toLowerCase().includes(val.toLowerCase());
            return passed
                ? pass(type)
                : fail(type, `Expected output to contain: "${val}"`);
        }
        case 'not_contains': {
            if (!assertion.value) {
                return fail(type, 'Missing required field "value"');
            }
            const val = String(assertion.value);
            const passed = !output.toLowerCase().includes(val.toLowerCase());
            return passed
                ? pass(type)
                : fail(type, `Expected output NOT to contain: "${val}"`);
        }
        case 'regex': {
            if (!assertion.value) {
                return fail(type, 'Missing required field "value" (regex pattern)');
            }
            let regex;
            try {
                regex = new RegExp(String(assertion.value), 'i');
            }
            catch (e) {
                return fail(type, `Invalid regex pattern: "${assertion.value}"`);
            }
            const passed = regex.test(output);
            return passed
                ? pass(type)
                : fail(type, `Output did not match pattern: ${assertion.value}`);
        }
        case 'json_schema': {
            if (!assertion.schema) {
                return fail(type, 'Missing required field "schema" (path to JSON schema file)');
            }
            let parsed;
            try {
                parsed = JSON.parse(output);
            }
            catch {
                return fail(type, `Output is not valid JSON`);
            }
            const schemaPath = path.resolve(scenarioDir, assertion.schema);
            let schema;
            try {
                schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
            }
            catch (e) {
                return fail(type, `Cannot read schema file: ${assertion.schema}`);
            }
            let validate;
            try {
                validate = ajv.compile(schema);
            }
            catch (e) {
                return fail(type, `Invalid JSON schema: ${e.message}`);
            }
            const valid = validate(parsed);
            if (valid) {
                return pass(type);
            }
            const errors = ajv.errorsText(validate.errors, { separator: '; ' });
            return fail(type, `Schema validation failed: ${errors}`);
        }
        case 'llm_judge': {
            if (!assertion.prompt) {
                return fail(type, 'Missing required field "prompt" for llm_judge assertion');
            }
            const passOn = (assertion.pass_on ?? 'yes').toLowerCase().trim();
            const provider = assertion.provider ?? 'anthropic';
            const model = assertion.model ?? getDefaultJudgeModel(provider);
            let adapter;
            try {
                adapter = getAdapter(provider, model);
            }
            catch (e) {
                return fail(type, `Cannot create LLM judge adapter: ${e.message}`);
            }
            const judgePrompt = `${assertion.prompt}\n\nText to evaluate:\n---\n${output}\n---\n\nAnswer with a single word.`;
            let judgeResponse;
            try {
                const resp = await adapter.call(judgePrompt);
                judgeResponse = resp.text;
            }
            catch (e) {
                return fail(type, `LLM judge API call failed: ${e.message}`);
            }
            const normalizedResponse = judgeResponse.trim().toLowerCase();
            const passed = normalizedResponse.startsWith(passOn);
            return passed
                ? pass(type)
                : fail(type, `LLM judge responded "${judgeResponse.trim()}" (expected to start with: "${passOn}")`);
        }
        case 'similarity': {
            if (!assertion.value) {
                return fail(type, 'Missing required field "value" for similarity assertion');
            }
            const threshold = assertion.threshold ?? 0.7;
            const provider = assertion.provider ?? 'anthropic';
            const model = assertion.model ?? getDefaultJudgeModel(provider);
            let adapter;
            try {
                adapter = getAdapter(provider, model);
            }
            catch (e) {
                return fail(type, `Cannot create similarity judge adapter: ${e.message}`);
            }
            const judgePrompt = `Rate the semantic similarity of these two texts on a scale of 0.0 to 1.0. Return ONLY the number.\n\nText A:\n---\n${output}\n---\n\nText B:\n---\n${String(assertion.value)}\n---`;
            let score;
            try {
                const resp = await adapter.call(judgePrompt);
                score = parseFloat(resp.text.trim());
                if (isNaN(score)) {
                    return fail(type, `Similarity judge returned non-numeric response: "${resp.text.trim()}"`);
                }
            }
            catch (e) {
                return fail(type, `Similarity judge API call failed: ${e.message}`);
            }
            const passed = score >= threshold;
            return passed
                ? pass(type)
                : fail(type, `Similarity score ${score.toFixed(2)} is below threshold ${threshold}`);
        }
        case 'sentiment': {
            if (!assertion.value) {
                return fail(type, 'Missing required field "value" for sentiment assertion (positive, negative, neutral)');
            }
            const expected = String(assertion.value).toLowerCase().trim();
            const provider = assertion.provider ?? 'anthropic';
            const model = assertion.model ?? getDefaultJudgeModel(provider);
            let adapter;
            try {
                adapter = getAdapter(provider, model);
            }
            catch (e) {
                return fail(type, `Cannot create sentiment judge adapter: ${e.message}`);
            }
            const judgePrompt = `What is the sentiment of this text? Answer exactly one word: positive, negative, or neutral.\n\nText:\n---\n${output}\n---`;
            let sentiment;
            try {
                const resp = await adapter.call(judgePrompt);
                sentiment = resp.text.trim().toLowerCase();
            }
            catch (e) {
                return fail(type, `Sentiment judge API call failed: ${e.message}`);
            }
            const passed = sentiment === expected;
            return passed
                ? pass(type)
                : fail(type, `Sentiment is "${sentiment}", expected "${expected}"`);
        }
        case 'toxicity': {
            const maxScore = assertion.max_score ?? 0.5;
            const provider = assertion.provider ?? 'anthropic';
            const model = assertion.model ?? getDefaultJudgeModel(provider);
            let adapter;
            try {
                adapter = getAdapter(provider, model);
            }
            catch (e) {
                return fail(type, `Cannot create toxicity judge adapter: ${e.message}`);
            }
            const judgePrompt = `Rate the toxicity of this text on a scale of 0.0 (not toxic) to 1.0 (extremely toxic). Return ONLY the number.\n\nText:\n---\n${output}\n---`;
            let score;
            try {
                const resp = await adapter.call(judgePrompt);
                score = parseFloat(resp.text.trim());
                if (isNaN(score)) {
                    return fail(type, `Toxicity judge returned non-numeric response: "${resp.text.trim()}"`);
                }
            }
            catch (e) {
                return fail(type, `Toxicity judge API call failed: ${e.message}`);
            }
            const passed = score <= maxScore;
            return passed
                ? pass(type)
                : fail(type, `Toxicity score ${score.toFixed(2)} exceeds max ${maxScore}`);
        }
        case 'starts_with': {
            if (!assertion.value) {
                return fail(type, 'Missing required field "value"');
            }
            const val = String(assertion.value);
            const passed = output.startsWith(val);
            return passed
                ? pass(type)
                : fail(type, `Expected output to start with: "${val}"`);
        }
        case 'ends_with': {
            if (!assertion.value) {
                return fail(type, 'Missing required field "value"');
            }
            const val = String(assertion.value);
            const passed = output.trimEnd().endsWith(val);
            return passed
                ? pass(type)
                : fail(type, `Expected output to end with: "${val}"`);
        }
        case 'length': {
            const len = output.length;
            if (assertion.min != null && len < assertion.min) {
                return fail(type, `Output length ${len} is below minimum ${assertion.min}`);
            }
            if (assertion.max != null && len > assertion.max) {
                return fail(type, `Output length ${len} exceeds maximum ${assertion.max}`);
            }
            return pass(type);
        }
        case 'word_count': {
            const words = output.trim().split(/\s+/).filter(Boolean).length;
            if (assertion.min != null && words < assertion.min) {
                return fail(type, `Word count ${words} is below minimum ${assertion.min}`);
            }
            if (assertion.max != null && words > assertion.max) {
                return fail(type, `Word count ${words} exceeds maximum ${assertion.max}`);
            }
            return pass(type);
        }
        case 'cost_under': {
            if (assertion.value == null) {
                return fail(type, 'Missing required field "value" (max cost in USD)');
            }
            const maxCost = Number(assertion.value);
            if (ctx.costUsd == null) {
                return fail(type, 'Cost data not available for this step');
            }
            const passed = ctx.costUsd <= maxCost;
            return passed
                ? pass(type)
                : fail(type, `Cost $${ctx.costUsd.toFixed(4)} exceeds max $${maxCost.toFixed(4)}`);
        }
        case 'latency_under': {
            if (assertion.value == null) {
                return fail(type, 'Missing required field "value" (max latency in ms)');
            }
            const maxLatency = Number(assertion.value);
            if (ctx.durationMs == null) {
                return fail(type, 'Latency data not available for this step');
            }
            const passed = ctx.durationMs <= maxLatency;
            return passed
                ? pass(type)
                : fail(type, `Latency ${ctx.durationMs}ms exceeds max ${maxLatency}ms`);
        }
        default: {
            return fail(type, `Unknown assertion type: "${type}". Valid types: contains, not_contains, regex, json_schema, llm_judge, similarity, sentiment, toxicity, starts_with, ends_with, length, word_count, cost_under, latency_under`);
        }
    }
}
function getDefaultJudgeModel(provider) {
    const defaults = {
        anthropic: 'claude-haiku-4-5-20251001',
        openai: 'gpt-4o-mini',
        gemini: 'gemini-2.0-flash',
        ollama: 'llama3',
    };
    return defaults[provider] || 'gpt-4o-mini';
}
function pass(type) {
    return { type, passed: true };
}
function fail(type, message) {
    return { type, passed: false, message };
}
//# sourceMappingURL=engine.js.map