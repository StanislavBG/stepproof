import type { AdapterResponse, ProviderAdapter } from './base.js';
export declare class AnthropicAdapter implements ProviderAdapter {
    private client;
    private model;
    constructor(model: string);
    call(prompt: string, system?: string): Promise<AdapterResponse>;
}
//# sourceMappingURL=anthropic.d.ts.map