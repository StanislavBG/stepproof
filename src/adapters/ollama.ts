import type { AdapterResponse, ProviderAdapter } from './base.js';

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

interface OllamaResponse {
  response: string;
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

  async call(prompt: string, system?: string): Promise<AdapterResponse> {
    const startMs = Date.now();
    const response = await withRetry(() =>
      fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          ...(system && { system }),
          stream: false,
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

    const data = (await response.json()) as OllamaResponse;
    const usage =
      data.prompt_eval_count != null && data.eval_count != null
        ? { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count }
        : undefined;

    return { text: data.response, usage, durationMs };
  }
}
