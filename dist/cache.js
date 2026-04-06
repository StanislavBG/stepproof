import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
const CACHE_DIR = path.resolve('.stepproof', 'cache');
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
/** SHA-256 hash of provider|model|system|prompt */
function cacheKey(provider, model, prompt, system) {
    const input = `${provider}|${model}|${system ?? ''}|${prompt}`;
    return crypto.createHash('sha256').update(input).digest('hex');
}
function cachePath(key) {
    return path.join(CACHE_DIR, `${key}.json`);
}
export function getCached(provider, model, prompt, system) {
    const key = cacheKey(provider, model, prompt, system);
    const fp = cachePath(key);
    try {
        if (!fs.existsSync(fp))
            return null;
        const entry = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        if (Date.now() - entry.timestamp > TTL_MS) {
            // Expired — remove stale entry
            try {
                fs.unlinkSync(fp);
            }
            catch { /* ignore */ }
            return null;
        }
        return {
            text: entry.response,
            usage: entry.usage,
            durationMs: entry.durationMs,
        };
    }
    catch {
        return null;
    }
}
export function setCache(provider, model, prompt, system, response) {
    const key = cacheKey(provider, model, prompt, system);
    const entry = {
        response: response.text,
        usage: response.usage,
        durationMs: response.durationMs,
        timestamp: Date.now(),
        provider,
        model,
    };
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cachePath(key), JSON.stringify(entry), 'utf-8');
    }
    catch {
        // Degrade gracefully — caching is best-effort
    }
}
export function clearCache() {
    if (!fs.existsSync(CACHE_DIR))
        return 0;
    const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
    let count = 0;
    for (const file of files) {
        try {
            fs.unlinkSync(path.join(CACHE_DIR, file));
            count++;
        }
        catch { /* ignore */ }
    }
    return count;
}
//# sourceMappingURL=cache.js.map