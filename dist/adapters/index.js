import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { GeminiAdapter } from './gemini.js';
import { OllamaAdapter } from './ollama.js';
import { AzureOpenAIAdapter } from './azure-openai.js';
import { BedrockAdapter } from './bedrock.js';
export function getAdapter(provider, model) {
    switch (provider) {
        case 'openai':
            return new OpenAIAdapter(model);
        case 'anthropic':
            return new AnthropicAdapter(model);
        case 'gemini':
            return new GeminiAdapter(model);
        case 'ollama':
            return new OllamaAdapter(model);
        case 'azure-openai':
            return new AzureOpenAIAdapter(model);
        case 'bedrock':
            return new BedrockAdapter(model);
        default:
            throw new Error(`Unknown provider: "${provider}". Supported providers: openai, anthropic, gemini, ollama, azure-openai, bedrock`);
    }
}
/**
 * Load a custom provider plugin from a JS file and wrap it as a ProviderAdapter.
 * The plugin must export an object/class with at least a `call(prompt, system?)` method.
 * An optional `chat(messages, system?)` method is used if present; otherwise chat
 * falls back to call() with the last user message.
 */
export async function getCustomAdapter(pluginPath) {
    let mod;
    try {
        mod = await import(pluginPath);
    }
    catch (e) {
        throw new Error(`Failed to load custom provider plugin: ${pluginPath}: ${e.message}`);
    }
    // Support both CJS (module.exports = { call }) and ESM (export default { call })
    const plugin = (typeof mod.default === 'object' && mod.default !== null ? mod.default : mod);
    if (typeof plugin.call !== 'function') {
        throw new Error(`Custom provider plugin must export a "call(prompt, system?)" method: ${pluginPath}`);
    }
    const callFn = plugin.call.bind(plugin);
    const chatFn = typeof plugin.chat === 'function'
        ? plugin.chat.bind(plugin)
        : async (messages, system, _options) => {
            // Fallback: concatenate messages into a single prompt
            const lastUser = [...messages].reverse().find(m => m.role === 'user');
            return callFn(lastUser?.content ?? '', system);
        };
    return { call: callFn, chat: chatFn };
}
//# sourceMappingURL=index.js.map