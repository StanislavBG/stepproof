import type { ProviderAdapter } from './base.js';
export declare class AnthropicAdapter implements ProviderAdapter {
    private client;
    private model;
    constructor(model: string);
    call(prompt: string, system?: string): Promise<string>;
}
//# sourceMappingURL=anthropic.d.ts.map