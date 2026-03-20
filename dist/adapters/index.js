import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
export function getAdapter(provider, model) {
    switch (provider) {
        case 'openai':
            return new OpenAIAdapter(model);
        case 'anthropic':
            return new AnthropicAdapter(model);
        default:
            throw new Error(`Unknown provider: "${provider}". Supported providers: openai, anthropic`);
    }
}
//# sourceMappingURL=index.js.map