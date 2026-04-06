import type { AdapterResponse } from './adapters/base.js';
export declare function getCached(provider: string, model: string, prompt: string, system?: string): AdapterResponse | null;
export declare function setCache(provider: string, model: string, prompt: string, system: string | undefined, response: AdapterResponse): void;
export declare function clearCache(): number;
//# sourceMappingURL=cache.d.ts.map