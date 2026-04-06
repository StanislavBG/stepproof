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
    async call(prompt, system, options) {
        return this.chat([{ role: 'user', content: prompt }], system, options);
    }
    async chat(messages, system, options) {
        const apiMessages = [];
        for (const msg of messages) {
            if (msg.role === 'system') {
                system = system ? `${system}\n\n${msg.content}` : msg.content;
            }
            else {
                apiMessages.push({ role: msg.role, content: msg.content });
            }
        }
        const startMs = Date.now();
        const response = await withRetry(() => this.client.messages.create({
            model: this.model,
            max_tokens: options?.maxTokens ?? 1024,
            ...(system && { system }),
            ...(options?.temperature !== undefined && { temperature: options.temperature }),
            ...(options?.topP !== undefined && { top_p: options.topP }),
            messages: apiMessages,
        }));
        const durationMs = Date.now() - startMs;
        const content = response.content[0];
        const text = content?.type === 'text' ? content.text : '';
        return {
            text,
            usage: {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
            },
            durationMs,
        };
    }
    async *stream(prompt, system, options) {
        const apiMessages = [
            { role: 'user', content: prompt },
        ];
        const stream = this.client.messages.stream({
            model: this.model,
            max_tokens: options?.maxTokens ?? 1024,
            ...(system && { system }),
            ...(options?.temperature !== undefined && { temperature: options.temperature }),
            ...(options?.topP !== undefined && { top_p: options.topP }),
            messages: apiMessages,
        });
        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                yield { token: event.delta.text, timestampMs: Date.now() };
            }
        }
    }
}
//# sourceMappingURL=anthropic.js.map