import OpenAI from 'openai';
export class OpenAIAdapter {
    client;
    model;
    constructor(model) {
        this.model = model;
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable is required for OpenAI provider');
        }
        this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    async call(prompt, system) {
        const messages = [];
        if (system) {
            messages.push({ role: 'system', content: system });
        }
        messages.push({ role: 'user', content: prompt });
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages,
        });
        return response.choices[0]?.message?.content ?? '';
    }
}
//# sourceMappingURL=openai.js.map