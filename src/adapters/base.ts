export interface AdapterResponse {
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  durationMs: number;
}

export interface ProviderAdapter {
  call(prompt: string, system?: string): Promise<AdapterResponse>;
}
