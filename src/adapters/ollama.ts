import type { AdapterResponse, CallOptions, ChatMessage, ProviderAdapter } from './base.js';

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
      if (status !== 429 && !(status && status >= 500)) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw lastError;
}

interface OllamaChatResponse {
  message: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaAdapter implements ProviderAdapter {
  private baseUrl: string;
  private model: string;

  constructor(model: string) {
    this.model = model;
    this.baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  }

  async call(prompt: string, system?: string, options?: CallOptions): Promise<AdapterResponse> {
    return this.chat([{ role: 'user', content: prompt }], system, options);
  }

  async chat(messages: ChatMessage[], system?: string, options?: CallOptions): Promise<AdapterResponse> {
    const apiMessages: Array<{ role: string; content: string }> = [];
    if (system) {
      apiMessages.push({ role: 'system', content: system });
    }
    for (const msg of messages) {
      apiMessages.push({ role: msg.role, content: msg.content });
    }

    const ollamaOptions: Record<string, unknown> = {};
    if (options?.temperature !== undefined) ollamaOptions.temperature = options.temperature;
    if (options?.topP !== undefined) ollamaOptions.top_p = options.topP;
    if (options?.maxTokens !== undefined) ollamaOptions.num_predict = options.maxTokens;

    const startMs = Date.now();
    const response = await withRetry(() =>
      fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: apiMessages,
          stream: false,
          ...(Object.keys(ollamaOptions).length > 0 && { options: ollamaOptions }),
        }),
      })
    );
    const durationMs = Date.now() - startMs;

    if (!response.ok) {
      throw Object.assign(
        new Error(`Ollama request failed: ${response.status} ${response.statusText}`),
        { status: response.status }
      );
    }

    const data = (await response.json()) as OllamaChatResponse;
    const usage =
      data.prompt_eval_count != null && data.eval_count != null
        ? { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count }
        : undefined;

    return { text: data.message.content, usage, durationMs };
  }
}
