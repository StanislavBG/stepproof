import type { AdapterResponse, CallOptions, ChatMessage, ProviderAdapter } from './base.js';
export declare class BedrockAdapter implements ProviderAdapter {
    private model;
    private region;
    private accessKeyId;
    private secretAccessKey;
    constructor(model: string);
    call(prompt: string, system?: string, options?: CallOptions): Promise<AdapterResponse>;
    chat(messages: ChatMessage[], system?: string, options?: CallOptions): Promise<AdapterResponse>;
}
//# sourceMappingURL=bedrock.d.ts.map