import type { AdapterResponse, ProviderAdapter } from './base.js';
export declare class GeminiAdapter implements ProviderAdapter {
    private client;
    private model;
    constructor(model: string);
    call(prompt: string, system?: string): Promise<AdapterResponse>;
}
//# sourceMappingURL=gemini.d.ts.map