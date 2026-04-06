import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
const MAX_REF_DEPTH = 5;
export function parseScenario(filePath, env) {
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    }
    catch (e) {
        throw new Error(`Cannot read scenario file: ${filePath}\n  Hint: Check the path, or run 'stepproof init' to scaffold a starter scenario.`);
    }
    let raw;
    try {
        raw = yaml.load(content);
    }
    catch (e) {
        throw new Error(`Invalid YAML in scenario file: ${e.message}`);
    }
    if (!raw || typeof raw !== 'object') {
        throw new Error('Scenario file must be a YAML object');
    }
    const scenario = raw;
    if (!scenario.name || typeof scenario.name !== 'string') {
        throw new Error('Scenario must have a "name" field (string)');
    }
    if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
        throw new Error('Scenario must have a "steps" array with at least one step');
    }
    const scenarioDir = path.dirname(path.resolve(filePath));
    // Resolve $ref includes before validation
    const resolvedRawSteps = scenario.steps.map((rawStep, i) => resolveRef(rawStep, scenarioDir, 0, `step ${i + 1}`));
    const steps = resolvedRawSteps.map((rawStep, i) => validateStep(rawStep, i, scenarioDir));
    // Parse environments
    let environments;
    if (scenario.environments && typeof scenario.environments === 'object') {
        environments = {};
        for (const [envName, envVal] of Object.entries(scenario.environments)) {
            if (!envVal || typeof envVal !== 'object') {
                throw new Error(`Environment "${envName}" must be an object`);
            }
            const envObj = envVal;
            const override = {};
            if (typeof envObj.iterations === 'number')
                override.iterations = envObj.iterations;
            if (envObj.variables && typeof envObj.variables === 'object') {
                override.variables = envObj.variables;
            }
            if (envObj.steps && typeof envObj.steps === 'object') {
                override.steps = envObj.steps;
            }
            environments[envName] = override;
        }
    }
    let result = {
        name: scenario.name,
        iterations: typeof scenario.iterations === 'number' ? scenario.iterations : 10,
        variables: typeof scenario.variables === 'object' && scenario.variables !== null
            ? scenario.variables
            : {},
        environments,
        steps,
    };
    // Apply environment override: --env flag > STEPPROOF_ENV env var
    const effectiveEnv = env ?? process.env.STEPPROOF_ENV;
    if (effectiveEnv) {
        result = applyEnvironment(result, effectiveEnv);
    }
    return result;
}
/** Apply environment-specific overrides to a parsed scenario. */
function applyEnvironment(scenario, envName) {
    const envOverride = scenario.environments?.[envName];
    if (!envOverride) {
        throw new Error(`Environment "${envName}" not found. Available: ${Object.keys(scenario.environments ?? {}).join(', ') || 'none'}`);
    }
    const result = { ...scenario };
    if (envOverride.iterations !== undefined) {
        result.iterations = envOverride.iterations;
    }
    if (envOverride.variables) {
        result.variables = { ...result.variables, ...envOverride.variables };
    }
    if (envOverride.steps) {
        result.steps = result.steps.map(step => {
            const stepOverride = envOverride.steps[step.id];
            if (!stepOverride)
                return step;
            // Merge step fields — override wins, but preserve id and assertions
            return { ...step, ...stepOverride, id: step.id, assertions: step.assertions };
        });
    }
    return result;
}
/**
 * Resolve $ref in a step definition. If the step has a $ref field, load the
 * referenced YAML file and merge any local overrides on top. Supports recursive
 * refs up to MAX_REF_DEPTH.
 */
function resolveRef(rawStep, baseDir, depth, pos) {
    if (!rawStep || typeof rawStep !== 'object')
        return rawStep;
    const step = rawStep;
    if (typeof step.$ref !== 'string')
        return rawStep;
    if (depth >= MAX_REF_DEPTH) {
        throw new Error(`${pos}: $ref nesting exceeds maximum depth of ${MAX_REF_DEPTH} — possible circular reference`);
    }
    const refPath = path.resolve(baseDir, step.$ref);
    if (!fs.existsSync(refPath)) {
        throw new Error(`${pos}: $ref file not found: ${step.$ref} (resolved to ${refPath})`);
    }
    let refContent;
    try {
        refContent = yaml.load(fs.readFileSync(refPath, 'utf-8'));
    }
    catch (e) {
        throw new Error(`${pos}: Invalid YAML in $ref file ${step.$ref}: ${e.message}`);
    }
    if (!refContent || typeof refContent !== 'object') {
        throw new Error(`${pos}: $ref file ${step.$ref} must contain a YAML object`);
    }
    const refDir = path.dirname(refPath);
    const resolved = resolveRef(refContent, refDir, depth + 1, `${pos} ($ref: ${step.$ref})`);
    const { $ref: _, ...localOverrides } = step;
    return { ...resolved, ...localOverrides };
}
function validateStep(raw, index, scenarioDir) {
    if (!raw || typeof raw !== 'object') {
        throw new Error(`Step ${index + 1} must be an object`);
    }
    const step = raw;
    const pos = step.id ? `step "${step.id}"` : `step ${index + 1}`;
    if (!step.id || typeof step.id !== 'string') {
        throw new Error(`Step ${index + 1} must have an "id" field (string)`);
    }
    const validProviders = ['openai', 'anthropic', 'gemini', 'ollama', 'azure-openai', 'bedrock', 'custom'];
    if (!step.provider || !validProviders.includes(step.provider)) {
        throw new Error(`${pos}: "provider" must be one of: ${validProviders.join(', ')}`);
    }
    // Validate custom provider plugin path
    if (step.provider === 'custom') {
        if (!step.plugin || typeof step.plugin !== 'string') {
            throw new Error(`${pos}: "plugin" field is required when provider is "custom"`);
        }
        if (scenarioDir) {
            const pluginPath = path.resolve(scenarioDir, step.plugin);
            if (!fs.existsSync(pluginPath)) {
                throw new Error(`${pos}: custom provider plugin not found: ${step.plugin} (resolved to ${pluginPath})`);
            }
        }
    }
    if (!step.model || typeof step.model !== 'string') {
        throw new Error(`${pos}: "model" field is required (string)`);
    }
    // Parse conversation turns
    let conversation;
    if (Array.isArray(step.conversation)) {
        conversation = step.conversation.map((turn, ti) => {
            const role = turn.role;
            if (!role || !['user', 'assistant', 'system'].includes(role)) {
                throw new Error(`${pos}: conversation turn ${ti + 1} must have "role" of user, assistant, or system`);
            }
            return {
                role: role,
                content: typeof turn.content === 'string' ? turn.content : undefined,
            };
        });
    }
    // prompt is required unless conversation is provided
    if (!conversation && (!step.prompt || typeof step.prompt !== 'string')) {
        throw new Error(`${pos}: "prompt" field is required (string) unless "conversation" is provided`);
    }
    // Parse depends_on
    let dependsOn;
    if (Array.isArray(step.depends_on)) {
        dependsOn = step.depends_on.map((d, di) => {
            if (typeof d !== 'string') {
                throw new Error(`${pos}: depends_on[${di}] must be a string (step ID)`);
            }
            return d;
        });
    }
    // Parse if condition
    const ifCondition = typeof step.if === 'string' ? step.if : undefined;
    const minPassRate = typeof step.min_pass_rate === 'number' ? step.min_pass_rate : 0.8;
    if (minPassRate < 0 || minPassRate > 1) {
        throw new Error(`${pos}: "min_pass_rate" must be between 0.0 and 1.0`);
    }
    // Retry validation
    const retry = typeof step.retry === 'number' ? step.retry : undefined;
    if (retry !== undefined && (retry < 0 || !Number.isInteger(retry))) {
        throw new Error(`${pos}: "retry" must be a non-negative integer`);
    }
    const retryDelay = typeof step.retry_delay === 'number' ? step.retry_delay : undefined;
    if (retryDelay !== undefined && retryDelay < 0) {
        throw new Error(`${pos}: "retry_delay" must be a non-negative number`);
    }
    // Step-level LLM config validation
    const temperature = typeof step.temperature === 'number' ? step.temperature : undefined;
    if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
        throw new Error(`${pos}: "temperature" must be between 0 and 2`);
    }
    const topP = typeof step.top_p === 'number' ? step.top_p : undefined;
    if (topP !== undefined && (topP < 0 || topP > 1)) {
        throw new Error(`${pos}: "top_p" must be between 0.0 and 1.0`);
    }
    const maxTokens = typeof step.max_tokens === 'number' ? step.max_tokens : undefined;
    if (maxTokens !== undefined && maxTokens <= 0) {
        throw new Error(`${pos}: "max_tokens" must be > 0`);
    }
    const timeout = typeof step.timeout === 'number' ? step.timeout : undefined;
    if (timeout !== undefined && timeout <= 0) {
        throw new Error(`${pos}: "timeout" must be > 0`);
    }
    const streamFlag = typeof step.stream === 'boolean' ? step.stream : undefined;
    // Validate custom assertion plugin paths
    if (Array.isArray(step.assertions) && scenarioDir) {
        for (const assertion of step.assertions) {
            if (assertion.type === 'custom') {
                if (!assertion.plugin || typeof assertion.plugin !== 'string') {
                    throw new Error(`${pos}: custom assertion requires a "plugin" field (path to JS file)`);
                }
                const pluginPath = path.resolve(scenarioDir, assertion.plugin);
                if (!fs.existsSync(pluginPath)) {
                    throw new Error(`${pos}: custom assertion plugin not found: ${assertion.plugin} (resolved to ${pluginPath})`);
                }
            }
        }
    }
    return {
        id: step.id,
        provider: step.provider,
        model: step.model,
        plugin: typeof step.plugin === 'string' ? step.plugin : undefined,
        prompt: typeof step.prompt === 'string' ? step.prompt : undefined,
        system: typeof step.system === 'string' ? step.system : undefined,
        conversation,
        depends_on: dependsOn,
        if: ifCondition,
        min_pass_rate: minPassRate,
        retry,
        retry_delay: retryDelay,
        temperature,
        top_p: topP,
        max_tokens: maxTokens,
        timeout,
        stream: streamFlag,
        assertions: Array.isArray(step.assertions) ? step.assertions : [],
    };
}
export function substituteVariables(template, variables, stepOutputs) {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
        const trimmed = key.trim();
        // Check for step output reference: {{step_id.output}}
        if (trimmed.includes('.')) {
            const [stepId, field] = trimmed.split('.', 2);
            if (field === 'output' && stepOutputs[stepId] !== undefined) {
                return stepOutputs[stepId];
            }
        }
        // Check global variables
        if (variables[trimmed] !== undefined) {
            return variables[trimmed];
        }
        // Check environment variables
        if (process.env[trimmed] !== undefined) {
            return process.env[trimmed];
        }
        // Leave unresolved — caller decides if this is an error
        return match;
    });
}
//# sourceMappingURL=scenario-parser.js.map