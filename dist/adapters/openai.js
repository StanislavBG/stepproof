import OpenAI from 'openai';
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
            // Only retry on rate limit (429) or server error (5xx)
            if (status !== 429 && !(status && status >= 500))
                throw err;
            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            await new Promise((res) => setTimeout(res, delay));
        }
    }
    throw lastError;
}
export class OpenAIAdapter {
    client;
    model;
    constructor(model) {
        this.model = model;
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable is required for OpenAI provider');
        }
        this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    async call(prompt, system) {
        return this.chat([{ role: 'user', content: prompt }], system);
    }
    async chat(messages, system) {
        const apiMessages = [];
        if (system) {
            apiMessages.push({ role: 'system', content: system });
        }
        for (const msg of messages) {
            apiMessages.push({ role: msg.role, content: msg.content });
        }
        const startMs = Date.now();
        const response = await withRetry(() => this.client.chat.completions.create({ model: this.model, messages: apiMessages }));
        const durationMs = Date.now() - startMs;
        const text = response.choices[0]?.message?.content ?? '';
        const usage = response.usage
            ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens }
            : undefined;
        return { text, usage, durationMs };
    }
}
//# sourceMappingURL=openai.js.map