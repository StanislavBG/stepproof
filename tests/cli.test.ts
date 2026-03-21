/**
 * CLI integration tests for stepproof.
 * Spawns the actual compiled CLI binary and verifies exit codes + output.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const CLI = path.resolve(__dirname, '../dist/cli.js');

function run(args: string[], cwd?: string) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd ?? os.tmpdir(),
    encoding: 'utf-8',
    timeout: 10000,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// Minimal valid scenario YAML for happy-path tests
const VALID_SCENARIO = `
name: smoke-test
steps:
  - id: step-one
    prompt: "Say hello"
    assertions:
      - type: contains
        value: hello
        min_pass_rate: 0.8
iterations: 1
`;

describe('stepproof CLI — exit codes', () => {
  it('no args → shows help and exits 0', () => {
    const { code, stdout } = run([]);
    expect(code).toBe(0);
    expect(stdout).toContain('stepproof');
    expect(stdout).toContain('Usage:');
  });

  it('--help → exits 0', () => {
    const { code, stdout } = run(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('stepproof');
  });

  it('--version → exits 0 and prints version', () => {
    const { code, stdout } = run(['--version']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+/);
  });

  it('unknown command → exits 2', () => {
    const { code, stderr } = run(['badcommand']);
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown command');
    expect(stderr).toContain('--help');
  });
});

describe('stepproof CLI — run command input validation', () => {
  it('run with nonexistent file → exits 2 with helpful message', () => {
    const { code, stderr } = run(['run', '/nonexistent/scenario.yaml']);
    expect(code).toBe(2);
    expect(stderr).toContain('Error');
  });

  it('run with empty YAML file → exits 2', () => {
    const tmpFile = path.join(os.tmpdir(), 'stepproof-empty.yaml');
    fs.writeFileSync(tmpFile, '');
    const { code, stderr } = run(['run', tmpFile]);
    expect(code).toBe(2);
    expect(stderr).toContain('Error');
    fs.unlinkSync(tmpFile);
  });

  it('run with invalid YAML → exits 2', () => {
    const tmpFile = path.join(os.tmpdir(), 'stepproof-bad.yaml');
    fs.writeFileSync(tmpFile, 'invalid: yaml: {{{');
    const { code, stderr } = run(['run', tmpFile]);
    expect(code).toBe(2);
    expect(stderr).toContain('Error');
    fs.unlinkSync(tmpFile);
  });

  it('run with malformed scenario (missing required fields) → exits 2', () => {
    const tmpFile = path.join(os.tmpdir(), 'stepproof-malformed.yaml');
    fs.writeFileSync(tmpFile, 'name: test\n# missing steps\n');
    const { code, stderr } = run(['run', tmpFile]);
    expect(code).toBe(2);
    expect(stderr).toContain('Error');
    fs.unlinkSync(tmpFile);
  });

  it('run with invalid --format → exits 2 with clear message', () => {
    const tmpFile = path.join(os.tmpdir(), 'stepproof-fmt.yaml');
    fs.writeFileSync(tmpFile, VALID_SCENARIO);
    const { code, stderr } = run(['run', tmpFile, '--format', 'csv']);
    expect(code).toBe(2);
    expect(stderr).toContain('--format');
    fs.unlinkSync(tmpFile);
  });
});

describe('stepproof CLI — init command', () => {
  it('init → creates scenarios/first-test.yaml and exits 0', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepproof-init-'));
    const { code } = run(['init'], tmpDir);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, 'scenarios', 'first-test.yaml'))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('init --help → exits 0', () => {
    const { code } = run(['init', '--help']);
    expect(code).toBe(0);
  });
});
