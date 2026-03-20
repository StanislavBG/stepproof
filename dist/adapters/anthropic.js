import Anthropic from '@anthropic-ai/sdk';
export class AnthropicAdapter {
    client;
    model;
    constructor(model) {
        this.model = model;
        if (!process.env.ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_API_KEY environment variable is required for Anthropic provider');
        }
        this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    async call(prompt, system) {
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
//# sourceMappingURL=anthropic.js.map