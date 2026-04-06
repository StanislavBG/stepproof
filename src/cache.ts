import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { AdapterResponse } from './adapters/base.js';

const CACHE_DIR = path.resolve('.stepproof', 'cache');
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  response: string;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
  timestamp: number;
  provider: string;
  model: string;
}

/** SHA-256 hash of provider|model|system|prompt */
function cacheKey(provider: string, model: string, prompt: string, system?: string): string {
  const input = `${provider}|${model}|${system ?? ''}|${prompt}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

function cachePath(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

export function getCached(provider: string, model: string, prompt: string, system?: string): AdapterResponse | null {
  const key = cacheKey(provider, model, prompt, system);
  const fp = cachePath(key);
  try {
    if (!fs.existsSync(fp)) return null;
    const entry = JSON.parse(fs.readFileSync(fp, 'utf-8')) as CacheEntry;
    if (Date.now() - entry.timestamp > TTL_MS) {
      // Expired — remove stale entry
      try { fs.unlinkSync(fp); } catch { /* ignore */ }
      return null;
    }
    return {
      text: entry.response,
      usage: entry.usage,
      durationMs: entry.durationMs,
    };
  } catch {
    return null;
  }
}

export function setCache(provider: string, model: string, prompt: string, system: string | undefined, response: AdapterResponse): void {
  const key = cacheKey(provider, model, prompt, system);
  const entry: CacheEntry = {
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
  } catch {
    // Degrade gracefully — caching is best-effort
  }
}

export function clearCache(): number {
  if (!fs.existsSync(CACHE_DIR)) return 0;
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  let count = 0;
  for (const file of files) {
    try {
      fs.unlinkSync(path.join(CACHE_DIR, file));
      count++;
    } catch { /* ignore */ }
  }
  return count;
}
