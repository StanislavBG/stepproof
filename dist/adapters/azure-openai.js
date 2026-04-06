import { AzureOpenAI } from 'openai';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
async function withRetry(fn) {
    let lastError;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            const status = err.status;
            if (status !== 429 && !(status && status >= 500))
                throw err;
            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            await new Promise((res) => setTimeout(res, delay));
        }
    }
    throw lastError;
}
export class AzureOpenAIAdapter {
    client;
    deployment;
    constructor(deployment) {
        this.deployment = deployment;
        const apiKey = process.env.AZURE_OPENAI_API_KEY;
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        if (!apiKey) {
            throw new Error('AZURE_OPENAI_API_KEY environment variable is required for azure-openai provider');
        }
        if (!endpoint) {
            throw new Error('AZURE_OPENAI_ENDPOINT environment variable is required for azure-openai provider');
        }
        const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21';
        this.client = new AzureOpenAI({
            apiKey,
            endpoint,
            apiVersion,
            deployment,
        });
    }
    async call(prompt, system, options) {
        return this.chat([{ role: 'user', content: prompt }], system, options);
    }
    async chat(messages, system, options) {
        const apiMessages = [];
        if (system) {
            apiMessages.push({ role: 'system', content: system });
        }
        for (const msg of messages) {
            apiMessages.push({ role: msg.role, content: msg.content });
        }
        const startMs = Date.now();
        const response = await withRetry(() => this.client.chat.completions.create({
            model: this.deployment,
            messages: apiMessages,
            ...(options?.temperature !== undefined && { temperature: options.temperature }),
            ...(options?.topP !== undefined && { top_p: options.topP }),
            ...(options?.maxTokens !== undefined && { max_tokens: options.maxTokens }),
        }));
        const durationMs = Date.now() - startMs;
        const text = response.choices[0]?.message?.content ?? '';
        const usage = response.usage
            ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens }
            : undefined;
        return { text, usage, durationMs };
    }
    async *stream(prompt, system, options) {
        const apiMessages = [];
        if (system) {
            apiMessages.push({ role: 'system', content: system });
        }
        apiMessages.push({ role: 'user', content: prompt });
        const stream = await this.client.chat.completions.create({
            model: this.deployment,
            messages: apiMessages,
            stream: true,
            ...(options?.temperature !== undefined && { temperature: options.temperature }),
            ...(options?.topP !== undefined && { top_p: options.topP }),
            ...(options?.maxTokens !== undefined && { max_tokens: options.maxTokens }),
        });
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
                yield { token: delta, timestampMs: Date.now() };
            }
        }
    }
}
//# sourceMappingURL=azure-openai.js.map