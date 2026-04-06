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
    async call(prompt, system, options) {
        return this.chat([{ role: 'user', content: prompt }], system, options);
    }
    async chat(messages, system, options) {
        let effectiveSystem = system;
        for (const msg of messages) {
            if (msg.role === 'system') {
                effectiveSystem = effectiveSystem ? `${effectiveSystem}\n\n${msg.content}` : msg.content;
            }
        }
        const generationConfig = {};
        if (options?.temperature !== undefined)
            generationConfig.temperature = options.temperature;
        if (options?.topP !== undefined)
            generationConfig.topP = options.topP;
        if (options?.maxTokens !== undefined)
            generationConfig.maxOutputTokens = options.maxTokens;
        const generativeModel = this.client.getGenerativeModel({
            model: this.model,
            ...(effectiveSystem && { systemInstruction: effectiveSystem }),
            ...(Object.keys(generationConfig).length > 0 && { generationConfig }),
        });
        const nonSystemMessages = messages.filter(m => m.role !== 'system');
        if (nonSystemMessages.length === 1 && nonSystemMessages[0].role === 'user') {
            const startMs = Date.now();
            const result = await withRetry(() => generativeModel.generateContent(nonSystemMessages[0].content));
            const durationMs = Date.now() - startMs;
            const text = result.response.text();
            const usageMetadata = result.response.usageMetadata;
            const usage = usageMetadata
                ? { inputTokens: usageMetadata.promptTokenCount ?? 0, outputTokens: usageMetadata.candidatesTokenCount ?? 0 }
                : undefined;
            return { text, usage, durationMs };
        }
        const history = nonSystemMessages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));
        const lastMsg = nonSystemMessages[nonSystemMessages.length - 1];
        const chat = generativeModel.startChat({ history });
        const startMs = Date.now();
        const result = await withRetry(() => chat.sendMessage(lastMsg.content));
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