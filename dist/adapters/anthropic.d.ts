import type { AdapterResponse, CallOptions, ChatMessage, ProviderAdapter } from './base.js';
export declare class AnthropicAdapter implements ProviderAdapter {
    private client;
    private model;
    constructor(model: string);
    call(prompt: string, system?: string, options?: CallOptions): Promise<AdapterResponse>;
    chat(messages: ChatMessage[], system?: string, options?: CallOptions): Promise<AdapterResponse>;
    stream(prompt: string, system?: string, options?: CallOptions): AsyncGenerator<{
        token: string;
        timestampMs: number;
    }>;
}
//# sourceMappingURL=anthropic.d.ts.map