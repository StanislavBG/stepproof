import type { AdapterResponse, CallOptions, ChatMessage, ProviderAdapter } from './base.js';
export declare class OllamaAdapter implements ProviderAdapter {
    private baseUrl;
    private model;
    constructor(model: string);
    call(prompt: string, system?: string, options?: CallOptions): Promise<AdapterResponse>;
    chat(messages: ChatMessage[], system?: string, options?: CallOptions): Promise<AdapterResponse>;
}
//# sourceMappingURL=ollama.d.ts.map