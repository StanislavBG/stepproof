# Contributing to stepproof

Issues and PRs are welcome. stepproof is part of the [Preflight](https://github.com/StanislavBG/agent-gate) suite of AI agent pre-deploy CLIs. The CLI is and will remain free and open source.

---

## Dev setup

Requirements: Node 18+, npm

```bash
git clone https://github.com/StanislavBG/stepproof.git
cd stepproof
npm install
```

Run the tests:

```bash
npm test
```

Build the distributable:

```bash
npm run build
```

To run the CLI locally without installing globally:

```bash
npm run dev -- run examples/simple-chain.yaml
```

(`npm run dev` uses `tsx` to execute the TypeScript source directly without a build step.)

Or after building:

```bash
node dist/cli.js run ./examples/stepproof-example-simple-chain.yaml
```

---

## Project structure

```
src/
  cli.ts                  Entry point — wires up Commander commands
  commands/
    init.ts               `stepproof init [dir]` — scaffold starter scenario
  core/
    types.ts              Shared TypeScript types (Scenario, Step, Assertion, etc.)
    scenario-parser.ts    Load and validate YAML scenario files
    scenario-runner.ts    Execute steps, collect results, apply pass rate logic
  adapters/
    base.ts               Abstract provider interface
    anthropic.ts          Anthropic (Claude) provider
    openai.ts             OpenAI (GPT) provider
    index.ts              Provider registry — maps provider name to adapter
  assertions/
    engine.ts             Evaluate assertions against step output
  reporters/
    terminal-reporter.ts  Human-readable stdout output (default)
    sarif-reporter.ts     SARIF 2.1.0 output for GitHub Advanced Security
    junit-reporter.ts     JUnit XML output for Jenkins / CircleCI / TeamCity
    json-reporter.ts      Raw JSON output
schemas/                  JSON schemas for scenario validation
examples/                 Copy-paste ready scenario YAML files
```

---

## Running tests

```bash
# Run once
npm test

# Watch mode (re-runs on file change)
npm run test:watch
```

Tests use [Vitest](https://vitest.dev/). Provider calls in tests should be mocked — do not make live API calls in tests. Tests must pass without API keys set.

---

## Building

```bash
npm run build
```

This runs `tsc` and emits compiled output to `dist/`. The CLI entry point is `dist/cli.js`. The `prepublishOnly` hook runs this automatically before `npm publish`. The `dist/` directory is not committed.

---

## Scenario YAML format

A scenario file has a name, an iteration count, and one or more steps. Each step calls a provider, checks assertions, and passes or fails based on `min_pass_rate`.

```yaml
name: "My scenario"
iterations: 10

steps:
  - id: my_step
    provider: anthropic          # "anthropic" or "openai"
    model: claude-sonnet-4-6
    prompt: "Do something with {{variable}}"
    variables:
      variable: "some value"
    min_pass_rate: 0.90          # fraction of iterations that must pass (0.0–1.0)
    assertions:
      - type: contains
        value: "expected string"
      - type: not_contains
        value: "error"
      - type: regex
        pattern: "^[A-Z]"
      - type: json_schema
        schema: ./schemas/output.json
      - type: llm_judge
        prompt: "Is this output correct? Answer yes/no."
        pass_on: "yes"
```

Steps can reference previous step output using `{{step_id.output}}` in prompts.

---

## Adding a new assertion type

1. Add the implementation to `src/assertions/engine.ts`
2. Add a test covering the new type
3. Document it in the assertions table in `README.md`

## Adding a new provider

1. Create `src/adapters/<provider>.ts` implementing the `ProviderAdapter` interface from `base.ts`
2. Register it in `src/adapters/index.ts`
3. Add tests with mocked API calls
4. Add the provider name to the README and the environment variables table

---

## PR guidelines

Before opening a PR:

1. **Tests required** — new behavior needs a test. Bug fixes should include a regression test.
2. **TypeScript** — all source files are `.ts`, strict mode. No `any` without a comment explaining why. Exports are named, not default.
3. **Exit codes must work** — `stepproof run` must exit 0 on pass and 1 on fail. Exit 2 for user-facing CLI errors (`console.error` + `process.exit(2)`). This contract is non-negotiable.
4. **No live API calls in tests** — mock provider adapters. Tests must pass without `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set.
5. **Run `npm test` and `npm run build`** before pushing — both must succeed.

For larger changes (new assertion type, new provider, new reporter), open an issue first to discuss the approach.

Submitting:

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Make your changes, run tests and build
4. Open a PR against `main`

---

## Reporting issues

Please include:

- stepproof version (`stepproof --version`)
- Node version (`node --version`)
- The scenario YAML (redact any sensitive prompt content)
- The full terminal output
- What you expected vs what happened

Open issues at: https://github.com/StanislavBG/stepproof/issues

---

## License

MIT. Contributions are accepted under the same license.
