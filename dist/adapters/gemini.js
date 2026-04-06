import { GoogleGenerativeAI } from '@google/generative-ai';
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
export class GeminiAdapter {
    client;
    model;
    constructor(model) {
        this.model = model;
        const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY environment variable is required for Gemini provider');
        }
        this.client = new GoogleGenerativeAI(apiKey);
    }
    async call(prompt, system) {
        const generativeModel = this.client.getGenerativeModel({
            model: this.model,
            ...(system && { systemInstruction: system }),
        });
        const startMs = Date.now();
        const result = await withRetry(() => generativeModel.generateContent(prompt));
        const durationMs = Date.now() - startMs;
        const text = result.response.text();
        const usageMetadata = result.response.usageMetadata;
        const usage = usageMetadata
            ? { inputTokens: usageMetadata.promptTokenCount ?? 0, outputTokens: usageMetadata.candidatesTokenCount ?? 0 }
            : undefined;
        return { text, usage, durationMs };
    }
}
//# sourceMappingURL=gemini.js.map