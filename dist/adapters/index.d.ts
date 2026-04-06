import type { ProviderAdapter } from './base.js';
export declare function getAdapter(provider: string, model: string): ProviderAdapter;
/**
 * Load a custom provider plugin from a JS file and wrap it as a ProviderAdapter.
 * The plugin must export an object/class with at least a `call(prompt, system?)` method.
 * An optional `chat(messages, system?)` method is used if present; otherwise chat
 * falls back to call() with the last user message.
 */
export declare function getCustomAdapter(pluginPath: string): Promise<ProviderAdapter>;
export type { ProviderAdapter };
//# sourceMappingURL=index.d.ts.map