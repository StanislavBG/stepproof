export interface CallOptions {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
}
export interface AdapterResponse {
    text: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    durationMs: number;
    streamMetrics?: {
        ttftMs: number;
        tokensPerSecond: number;
        interTokenLatencyMs: number;
    };
}
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}
export interface ProviderAdapter {
    call(prompt: string, system?: string, options?: CallOptions): Promise<AdapterResponse>;
    chat(messages: ChatMessage[], system?: string, options?: CallOptions): Promise<AdapterResponse>;
    stream?(prompt: string, system?: string, options?: CallOptions): AsyncGenerator<{
        token: string;
        timestampMs: number;
    }>;
}
//# sourceMappingURL=base.d.ts.map