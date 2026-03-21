import Anthropic from '@anthropic-ai/sdk';
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
export class AnthropicAdapter {
    client;
    model;
    constructor(model) {
        this.model = model;
        if (!process.env.ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_API_KEY environment variable is required for Anthropic provider');
        }
        this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    async call(prompt, system) {
        const response = await withRetry(() => this.client.messages.create({
            model: this.model,
            max_tokens: 1024,
            ...(system && { system }),
            messages: [{ role: 'user', content: prompt }],
        }));
        const content = response.content[0];
        if (content?.type === 'text') {
            return content.text;
        }
        return '';
    }
}
//# sourceMappingURL=anthropic.js.map