import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import type { ProviderAdapter } from './base.js';

export function getAdapter(provider: string, model: string): ProviderAdapter {
  switch (provider) {
    case 'openai':
      return new OpenAIAdapter(model);
    case 'anthropic':
      return new AnthropicAdapter(model);
    default:
      throw new Error(`Unknown provider: "${provider}". Supported providers: openai, anthropic`);
  }
}

export type { ProviderAdapter };
