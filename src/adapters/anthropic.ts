import Anthropic from '@anthropic-ai/sdk';
import type { ProviderAdapter } from './base.js';

export class AnthropicAdapter implements ProviderAdapter {
  private client: Anthropic;
  private model: string;

  constructor(model: string) {
    this.model = model;
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required for Anthropic provider');
    }
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async call(prompt: string, system?: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      ...(system && { system }),
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content?.type === 'text') {
      return content.text;
    }

    return '';
  }
}
