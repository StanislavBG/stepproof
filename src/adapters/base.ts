export interface ProviderAdapter {
  call(prompt: string, system?: string): Promise<string>;
}
