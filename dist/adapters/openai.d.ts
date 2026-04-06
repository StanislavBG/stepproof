import type { AdapterResponse, ProviderAdapter } from './base.js';
export declare class OpenAIAdapter implements ProviderAdapter {
    private client;
    private model;
    constructor(model: string);
    call(prompt: string, system?: string): Promise<AdapterResponse>;
}
//# sourceMappingURL=openai.d.ts.map