import Anthropic from '@anthropic-ai/sdk';
import type { AdapterResponse, ChatMessage, ProviderAdapter } from './base.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { status?: number }).status;
      // Only retry on rate limit (429) or server error (5xx)
      if (status !== 429 && !(status && status >= 500)) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw lastError;
}

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

  async call(prompt: string, system?: string): Promise<AdapterResponse> {
    return this.chat([{ role: 'user', content: prompt }], system);
  }

  async chat(messages: ChatMessage[], system?: string): Promise<AdapterResponse> {
    // Anthropic API requires alternating user/assistant messages.
    // System messages are passed via the top-level system param.
    const apiMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        // Fold into system param — Anthropic doesn't support system in messages array
        system = system ? `${system}\n\n${msg.content}` : msg.content;
      } else {
        apiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const startMs = Date.now();
    const response = await withRetry(() =>
      this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        ...(system && { system }),
        messages: apiMessages,
      })
    );
    const durationMs = Date.now() - startMs;

    const content = response.content[0];
    const text = content?.type === 'text' ? content.text : '';

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      durationMs,
    };
  }
}
