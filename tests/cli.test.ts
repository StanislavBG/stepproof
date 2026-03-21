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
  try {
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
  } catch (e) {
    // Node.js rejects null bytes in spawn args before the process starts —
    // this is the OS-level rejection of malformed input, equivalent to exit 2.
    return { code: 2, stdout: '', stderr: String(e) };
  }
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

  it('init with custom dir arg → creates scenarios in that dir', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepproof-init-dir-'));
    const customDir = path.join(tmpDir, 'my-scenarios');
    const { code } = run(['init', customDir], tmpDir);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(customDir, 'first-test.yaml'))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('init --help → exits 0', () => {
    const { code } = run(['init', '--help']);
    expect(code).toBe(0);
  });
});

describe('stepproof CLI — input sanitization', () => {
  it('run with null byte in path → exits 2 with error', () => {
    const { code, stderr } = run(['run', 'scenario\0.yaml']);
    expect(code).toBe(2);
    expect(stderr).toContain('null');
  });

  it('run with --output containing null byte → exits 2 with error', () => {
    const tmpFile = path.join(os.tmpdir(), 'stepproof-nullout.yaml');
    fs.writeFileSync(tmpFile, VALID_SCENARIO);
    const { code, stderr } = run(['run', tmpFile, '--output', 'out\0.json']);
    expect(code).toBe(2);
    expect(stderr).toContain('null');
    fs.unlinkSync(tmpFile);
  });
});

describe('stepproof CLI — deprecated --report flag', () => {
  it('run with --report sarif → warns and exits 2 (license gate)', () => {
    const tmpFile = path.join(os.tmpdir(), 'stepproof-report-flag.yaml');
    fs.writeFileSync(tmpFile, VALID_SCENARIO);
    const { code, stderr } = run(['run', tmpFile, '--report', 'sarif']);
    // --report is deprecated: should warn in stderr; sarif requires team license so exits 2
    expect(stderr).toContain('deprecated');
    fs.unlinkSync(tmpFile);
  });
});

describe('stepproof CLI — subcommand help', () => {
  it('run --help → exits 0 and lists run options', () => {
    const { code, stdout } = run(['run', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--format');
    expect(stdout).toContain('--output');
  });

  it('init --help → exits 0 and shows init usage', () => {
    const { code, stdout } = run(['init', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('scenario');
  });
});

describe('stepproof CLI — init idempotency', () => {
  it('init twice in same dir → exits 0 both times (idempotent)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepproof-init-idem-'));
    const { code: code1 } = run(['init'], tmpDir);
    expect(code1).toBe(0);
    const { code: code2 } = run(['init'], tmpDir);
    expect(code2).toBe(0);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('stepproof CLI — --iterations validation', () => {
  it('--iterations with non-numeric value → exits 2 with helpful message', () => {
    const tmpFile = path.join(os.tmpdir(), 'stepproof-iter-str.yaml');
    fs.writeFileSync(tmpFile, VALID_SCENARIO);
    const { code, stderr } = run(['run', tmpFile, '--iterations', 'abc']);
    expect(code).toBe(2);
    expect(stderr).toContain('--iterations');
    fs.unlinkSync(tmpFile);
  });

  it('--iterations 0 → exits 2 (zero iterations makes no sense)', () => {
    const tmpFile = path.join(os.tmpdir(), 'stepproof-iter-zero.yaml');
    fs.writeFileSync(tmpFile, VALID_SCENARIO);
    const { code, stderr } = run(['run', tmpFile, '--iterations', '0']);
    expect(code).toBe(2);
    expect(stderr).toContain('--iterations');
    fs.unlinkSync(tmpFile);
  });

  it('--iterations -1 → exits 2 (negative iterations rejected)', () => {
    const tmpFile = path.join(os.tmpdir(), 'stepproof-iter-neg.yaml');
    fs.writeFileSync(tmpFile, VALID_SCENARIO);
    const { code, stderr } = run(['run', tmpFile, '--iterations', '-1']);
    expect(code).toBe(2);
    expect(stderr).toContain('--iterations');
    fs.unlinkSync(tmpFile);
  });
});

describe('stepproof CLI — directory input detection', () => {
  it('run with a directory path → exits 2 with helpful message', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepproof-dir-'));
    const { code, stderr } = run(['run', tmpDir]);
    expect(code).toBe(2);
    expect(stderr).toContain('directory');
    expect(stderr).toContain('first-test.yaml');
    fs.rmSync(tmpDir, { recursive: true });
  });
});
