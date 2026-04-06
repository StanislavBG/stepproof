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
export class OllamaAdapter {
    baseUrl;
    model;
    constructor(model) {
        this.model = model;
        this.baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    }
    async call(prompt, system) {
        return this.chat([{ role: 'user', content: prompt }], system);
    }
    async chat(messages, system) {
        // Build Ollama chat API messages array
        const apiMessages = [];
        if (system) {
            apiMessages.push({ role: 'system', content: system });
        }
        for (const msg of messages) {
            apiMessages.push({ role: msg.role, content: msg.content });
        }
        const startMs = Date.now();
        const response = await withRetry(() => fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                messages: apiMessages,
                stream: false,
            }),
        }));
        const durationMs = Date.now() - startMs;
        if (!response.ok) {
            throw Object.assign(new Error(`Ollama request failed: ${response.status} ${response.statusText}`), { status: response.status });
        }
        const data = (await response.json());
        const usage = data.prompt_eval_count != null && data.eval_count != null
            ? { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count }
            : undefined;
        return { text: data.message.content, usage, durationMs };
    }
}
//# sourceMappingURL=ollama.js.map