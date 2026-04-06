import type { AdapterResponse, ChatMessage, ProviderAdapter } from './base.js';
export declare class OllamaAdapter implements ProviderAdapter {
    private baseUrl;
    private model;
    constructor(model: string);
    call(prompt: string, system?: string): Promise<AdapterResponse>;
    chat(messages: ChatMessage[], system?: string): Promise<AdapterResponse>;
}
//# sourceMappingURL=ollama.d.ts.map