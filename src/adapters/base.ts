export interface AdapterResponse {
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  durationMs: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ProviderAdapter {
  call(prompt: string, system?: string): Promise<AdapterResponse>;
  chat(messages: ChatMessage[], system?: string): Promise<AdapterResponse>;
}
