import type { AdapterResponse, CallOptions, ChatMessage, ProviderAdapter } from './base.js';
export declare class AzureOpenAIAdapter implements ProviderAdapter {
    private client;
    private deployment;
    constructor(deployment: string);
    call(prompt: string, system?: string, options?: CallOptions): Promise<AdapterResponse>;
    chat(messages: ChatMessage[], system?: string, options?: CallOptions): Promise<AdapterResponse>;
    stream(prompt: string, system?: string, options?: CallOptions): AsyncGenerator<{
        token: string;
        timestampMs: number;
    }>;
}
//# sourceMappingURL=azure-openai.d.ts.map