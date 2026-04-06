import { GoogleGenerativeAI } from '@google/generative-ai';
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

export class GeminiAdapter implements ProviderAdapter {
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(model: string) {
    this.model = model;
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'GOOGLE_API_KEY or GEMINI_API_KEY environment variable is required for Gemini provider'
      );
    }
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async call(prompt: string, system?: string): Promise<AdapterResponse> {
    return this.chat([{ role: 'user', content: prompt }], system);
  }

  async chat(messages: ChatMessage[], system?: string): Promise<AdapterResponse> {
    // Fold any system-role messages into the system instruction
    let effectiveSystem = system;
    for (const msg of messages) {
      if (msg.role === 'system') {
        effectiveSystem = effectiveSystem ? `${effectiveSystem}\n\n${msg.content}` : msg.content;
      }
    }

    const generativeModel = this.client.getGenerativeModel({
      model: this.model,
      ...(effectiveSystem && { systemInstruction: effectiveSystem }),
    });

    // Gemini uses "user" and "model" roles in history, final message sent via sendMessage
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    // If only one user message, use simple generateContent
    if (nonSystemMessages.length === 1 && nonSystemMessages[0].role === 'user') {
      const startMs = Date.now();
      const result = await withRetry(() => generativeModel.generateContent(nonSystemMessages[0].content));
      const durationMs = Date.now() - startMs;
      const text = result.response.text();
      const usageMetadata = result.response.usageMetadata;
      const usage = usageMetadata
        ? { inputTokens: usageMetadata.promptTokenCount ?? 0, outputTokens: usageMetadata.candidatesTokenCount ?? 0 }
        : undefined;
      return { text, usage, durationMs };
    }

    // Multi-turn: use startChat with history, send the last message
    const history = nonSystemMessages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const lastMsg = nonSystemMessages[nonSystemMessages.length - 1];
    const chat = generativeModel.startChat({ history });

    const startMs = Date.now();
    const result = await withRetry(() => chat.sendMessage(lastMsg.content));
    const durationMs = Date.now() - startMs;

    const text = result.response.text();
    const usageMetadata = result.response.usageMetadata;
    const usage = usageMetadata
      ? { inputTokens: usageMetadata.promptTokenCount ?? 0, outputTokens: usageMetadata.candidatesTokenCount ?? 0 }
      : undefined;

    return { text, usage, durationMs };
  }
}
