import * as fs from 'node:fs';
import * as path from 'node:path';
import { Ajv as AjvClass } from 'ajv';
import { getAdapter } from '../adapters/index.js';
const ajv = new AjvClass({ allErrors: true });
export async function runAssertions(output, assertions, scenarioDir) {
    const results = [];
    for (const assertion of assertions) {
        const result = await runAssertion(output, assertion, scenarioDir);
        results.push(result);
    }
    const allPassed = results.every((r) => r.passed);
    return { results, allPassed };
}
async function runAssertion(output, assertion, scenarioDir) {
    const { type } = assertion;
    switch (type) {
        case 'contains': {
            if (!assertion.value) {
                return fail(type, 'Missing required field "value"');
            }
            const passed = output.toLowerCase().includes(assertion.value.toLowerCase());
            return passed
                ? pass(type)
                : fail(type, `Expected output to contain: "${assertion.value}"`);
        }
        case 'not_contains': {
            if (!assertion.value) {
                return fail(type, 'Missing required field "value"');
            }
            const passed = !output.toLowerCase().includes(assertion.value.toLowerCase());
            return passed
                ? pass(type)
                : fail(type, `Expected output NOT to contain: "${assertion.value}"`);
        }
        case 'regex': {
            if (!assertion.value) {
                return fail(type, 'Missing required field "value" (regex pattern)');
            }
            let regex;
            try {
                regex = new RegExp(assertion.value, 'i');
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
            const model = assertion.model ?? (provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini');
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
                judgeResponse = await adapter.call(judgePrompt);
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
        default: {
            return fail(type, `Unknown assertion type: "${type}". Valid types: contains, not_contains, regex, json_schema, llm_judge`);
        }
    }
}
function pass(type) {
    return { type, passed: true };
}
function fail(type, message) {
    return { type, passed: false, message };
}
//# sourceMappingURL=engine.js.map