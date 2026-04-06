import * as crypto from 'node:crypto';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
async function withRetry(fn) {
    let lastError;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            const status = err.status;
            if (status !== 429 && !(status && status >= 500))
                throw err;
            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            await new Promise((res) => setTimeout(res, delay));
        }
    }
    throw lastError;
}
// ── Minimal AWS Signature V4 signer ─────────────────────────────────
// O(n) in payload size — single pass HMAC chain + SHA-256 hash
function hmacSha256(key, data) {
    return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}
function sha256Hex(data) {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}
function signRequest(method, url, headers, body, region, service, accessKeyId, secretAccessKey) {
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
    const amzDate = dateStamp + 'T' + now.toISOString().replace(/[-:T]/g, '').slice(8, 14) + 'Z';
    const payloadHash = sha256Hex(body);
    // Canonical headers — must be sorted by name
    const canonicalHeaders = {
        'content-type': headers['Content-Type'] ?? 'application/json',
        host: url.host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
    };
    const sortedHeaderNames = Object.keys(canonicalHeaders).sort();
    const canonicalHeaderStr = sortedHeaderNames.map(k => `${k}:${canonicalHeaders[k]}\n`).join('');
    const signedHeadersStr = sortedHeaderNames.join(';');
    const canonicalPath = url.pathname;
    const canonicalQueryString = url.search ? url.search.slice(1) : '';
    const canonicalRequest = [
        method,
        canonicalPath,
        canonicalQueryString,
        canonicalHeaderStr,
        signedHeadersStr,
        payloadHash,
    ].join('\n');
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join('\n');
    // Derive signing key: HMAC chain
    const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, region);
    const kService = hmacSha256(kRegion, service);
    const kSigning = hmacSha256(kService, 'aws4_request');
    const signature = hmacSha256(kSigning, stringToSign).toString('hex');
    return {
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
    };
}
export class BedrockAdapter {
    model;
    region;
    accessKeyId;
    secretAccessKey;
    constructor(model) {
        this.model = model;
        this.region = process.env.AWS_REGION ?? 'us-east-1';
        if (!process.env.AWS_ACCESS_KEY_ID) {
            throw new Error('AWS_ACCESS_KEY_ID environment variable is required for bedrock provider');
        }
        if (!process.env.AWS_SECRET_ACCESS_KEY) {
            throw new Error('AWS_SECRET_ACCESS_KEY environment variable is required for bedrock provider');
        }
        this.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
        this.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    }
    async call(prompt, system, options) {
        return this.chat([{ role: 'user', content: prompt }], system, options);
    }
    async chat(messages, system, options) {
        // Build Anthropic Messages API format (Bedrock uses the same schema for Claude models)
        const apiMessages = [];
        let effectiveSystem = system;
        for (const msg of messages) {
            if (msg.role === 'system') {
                effectiveSystem = effectiveSystem ? `${effectiveSystem}\n\n${msg.content}` : msg.content;
            }
            else {
                apiMessages.push({ role: msg.role, content: msg.content });
            }
        }
        const body = {
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: options?.maxTokens ?? 1024,
            messages: apiMessages,
        };
        if (effectiveSystem)
            body.system = effectiveSystem;
        if (options?.temperature !== undefined)
            body.temperature = options.temperature;
        if (options?.topP !== undefined)
            body.top_p = options.topP;
        const bodyStr = JSON.stringify(body);
        const encodedModel = encodeURIComponent(this.model);
        const endpoint = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${encodedModel}/invoke`;
        const url = new URL(endpoint);
        const reqHeaders = { 'Content-Type': 'application/json' };
        const sigHeaders = signRequest('POST', url, reqHeaders, bodyStr, this.region, 'bedrock', this.accessKeyId, this.secretAccessKey);
        const startMs = Date.now();
        const response = await withRetry(() => fetch(endpoint, {
            method: 'POST',
            headers: {
                ...reqHeaders,
                ...sigHeaders,
            },
            body: bodyStr,
        }));
        const durationMs = Date.now() - startMs;
        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw Object.assign(new Error(`Bedrock request failed: ${response.status} ${response.statusText} — ${errorBody}`), { status: response.status });
        }
        const data = (await response.json());
        const textBlock = data.content?.find(c => c.type === 'text');
        const text = textBlock?.text ?? '';
        const usage = data.usage
            ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
            : undefined;
        return { text, usage, durationMs };
    }
}
//# sourceMappingURL=bedrock.js.map