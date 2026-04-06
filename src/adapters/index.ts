import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { GeminiAdapter } from './gemini.js';
import { OllamaAdapter } from './ollama.js';
import type { ProviderAdapter } from './base.js';

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
    default:
      throw new Error(`Unknown provider: "${provider}". Supported providers: openai, anthropic, gemini, ollama`);
  }
}

export type { ProviderAdapter };
