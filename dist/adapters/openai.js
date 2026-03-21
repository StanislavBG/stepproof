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
        const messages = [];
        if (system) {
            messages.push({ role: 'system', content: system });
        }
        messages.push({ role: 'user', content: prompt });
        const response = await withRetry(() => this.client.chat.completions.create({ model: this.model, messages }));
        return response.choices[0]?.message?.content ?? '';
    }
}
//# sourceMappingURL=openai.js.map