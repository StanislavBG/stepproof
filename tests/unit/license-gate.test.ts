/**
 * License gate tests for stepproof --format flag.
 *
 * Tests the four required scenarios from Order #82:
 *  1. Valid key → proceeds (no exit)
 *  2. Invalid key → rejected (exit 1)
 *  3. Missing key → upgrade message shown (exit 1)
 *  4. Free features unaffected → no key needed
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { validate, guard, mintKey } from '@bilkobibitkov/preflight-license';

// Mint a valid key using the default signing secret
function validKey(org = 'test-org', days = 30): string {
  return mintKey({ org, tier: 'team', days, perpetual: false });
}

function expiredKey(org = 'test-org'): string {
  return mintKey({ org, tier: 'team', days: -1, perpetual: false });
}

// ── validate() unit tests ──────────────────────────────────────────────────

describe('validate()', () => {
  it('accepts a valid key', () => {
    const key = validKey();
    const result = validate(key);
    expect(result.valid).toBe(true);
    expect(result.tier).toBe('team');
    expect(result.org).toBe('test-org');
  });

  it('rejects an expired key', () => {
    const key = expiredKey();
    const result = validate(key);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expired/i);
  });

  it('rejects a malformed key', () => {
    const result = validate('not-a-real-key');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/invalid key format|missing prefix/i);
  });

  it('rejects a tampered key', () => {
    const key = validKey();
    // Flip a character in the signature
    const parts = key.split('.');
    parts[parts.length - 1] = parts[parts.length - 1].slice(0, -1) + 'X';
    const tampered = parts.join('.');
    const result = validate(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/invalid signature/i);
  });

  it('returns free tier for empty key', () => {
    const result = validate('');
    expect(result.valid).toBe(false);
    expect(result.tier).toBe('free');
  });
});

// ── guard() behavior tests ─────────────────────────────────────────────────

describe('guard()', () => {
  afterEach(() => {
    delete process.env.PREFLIGHT_LICENSE_KEY;
    vi.restoreAllMocks();
  });

  it('does not exit when valid team key is set', () => {
    process.env.PREFLIGHT_LICENSE_KEY = validKey();
    const exitFn = vi.fn((code: number) => { throw new Error(`exit:${code}`); }) as unknown as (code: number) => never;
    // Should NOT throw
    expect(() => guard('team', { feature: '--format sarif', exitFn })).not.toThrow();
  });

  it('exits with 1 and prints upgrade message when key is missing', () => {
    delete process.env.PREFLIGHT_LICENSE_KEY;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitFn = vi.fn((code: number) => { throw new Error(`exit:${code}`); }) as unknown as (code: number) => never;

    expect(() => guard('team', { feature: '--format sarif', exitFn })).toThrow('exit:1');
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Preflight Team required');
    expect(output).toContain('--format sarif');
    expect(output).toContain('preflight.so/pricing');
    expect(output).toContain('PREFLIGHT_LICENSE_KEY');
  });

  it('exits with 1 and prints upgrade message when key is invalid', () => {
    process.env.PREFLIGHT_LICENSE_KEY = 'preflight_garbage.invalidsig';
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitFn = vi.fn((code: number) => { throw new Error(`exit:${code}`); }) as unknown as (code: number) => never;

    expect(() => guard('team', { feature: '--format sarif', exitFn })).toThrow('exit:1');
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Preflight Team required');
  });

  it('free tier features are unaffected — guard("free") is a no-op', () => {
    delete process.env.PREFLIGHT_LICENSE_KEY;
    const exitFn = vi.fn((code: number) => { throw new Error(`exit:${code}`); }) as unknown as (code: number) => never;
    // guard('free') should never call exitFn
    expect(() => guard('free', { exitFn })).not.toThrow();
    expect(exitFn).not.toHaveBeenCalled();
  });

  it('free tier features are unaffected even if key is invalid', () => {
    process.env.PREFLIGHT_LICENSE_KEY = 'garbage';
    const exitFn = vi.fn((code: number) => { throw new Error(`exit:${code}`); }) as unknown as (code: number) => never;
    expect(() => guard('free', { exitFn })).not.toThrow();
  });
});
