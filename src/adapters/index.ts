import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { GeminiAdapter } from './gemini.js';
import { OllamaAdapter } from './ollama.js';
import { AzureOpenAIAdapter } from './azure-openai.js';
import { BedrockAdapter } from './bedrock.js';
import type { AdapterResponse, CallOptions, ChatMessage, ProviderAdapter } from './base.js';

export function getAdapter(provider: string, model: string): ProviderAdapter {
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
export async function getCustomAdapter(pluginPath: string): Promise<ProviderAdapter> {
  let mod: Record<string, unknown>;
  try {
    mod = await import(pluginPath);
  } catch (e) {
    throw new Error(`Failed to load custom provider plugin: ${pluginPath}: ${(e as Error).message}`);
  }

  // Support both CJS (module.exports = { call }) and ESM (export default { call })
  const plugin = (typeof mod.default === 'object' && mod.default !== null ? mod.default : mod) as Record<string, unknown>;

  if (typeof plugin.call !== 'function') {
    throw new Error(`Custom provider plugin must export a "call(prompt, system?)" method: ${pluginPath}`);
  }

  const callFn = plugin.call.bind(plugin) as (prompt: string, system?: string, options?: CallOptions) => Promise<AdapterResponse>;

  const chatFn: ProviderAdapter['chat'] = typeof plugin.chat === 'function'
    ? (plugin.chat.bind(plugin) as (messages: ChatMessage[], system?: string, options?: CallOptions) => Promise<AdapterResponse>)
    : async (messages: ChatMessage[], system?: string, _options?: CallOptions) => {
        // Fallback: concatenate messages into a single prompt
        const lastUser = [...messages].reverse().find(m => m.role === 'user');
        return callFn(lastUser?.content ?? '', system);
      };

  return { call: callFn, chat: chatFn };
}

export type { ProviderAdapter };
