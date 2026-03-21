# Contributing to stepproof

Thanks for your interest in contributing. stepproof is part of the [Preflight](https://github.com/StanislavBG/agent-gate) suite of AI agent pre-deploy CLIs.

## Dev setup

```bash
git clone https://github.com/StanislavBG/stepproof
cd stepproof
npm install
```

## Running tests

```bash
npm test
```

All tests use [vitest](https://vitest.dev/). Tests live in `./tests/`.

## Building

```bash
npm run build
```

TypeScript is compiled to `./dist/`. The CLI entry point is `dist/cli.js`.

## Running locally

```bash
# Run against a scenario without building
npm run dev -- run ./examples/stepproof-example-simple-chain.yaml

# Or after build
node dist/cli.js run ./examples/stepproof-example-simple-chain.yaml
```

## Project structure

```
src/
  cli.ts              — CLI entry point (Commander.js commands)
  commands/           — Command implementations (init)
  core/               — Scenario parser + runner
  adapters/           — Provider adapters (OpenAI, Anthropic)
  assertions/         — Assertion type implementations
  reporters/          — Output formatters (terminal, JSON, SARIF, JUnit)
schemas/              — JSON schemas for scenario validation
examples/             — Copy-paste ready scenario YAML files
tests/                — Vitest test suite
```

## Adding a new assertion type

1. Create `src/assertions/<type>.ts` implementing the `Assertion` interface
2. Register it in `src/assertions/index.ts`
3. Add a test in `tests/assertions/<type>.test.ts`
4. Document it in the assertions table in `README.md`

## Adding a new provider

1. Create `src/adapters/<provider>.ts` implementing the `ProviderAdapter` interface
2. Register it in `src/adapters/index.ts`
3. Add integration tests in `tests/adapters/<provider>.test.ts`
4. Add the provider name to the README

## Submitting changes

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Run tests: `npm test`
5. Build: `npm run build`
6. Open a PR against `main`

## Code style

- TypeScript strict mode
- No external linter config — keep it readable
- Exports are named, not default
- Errors go to `console.error` and `process.exit(2)` for user-facing CLI errors

## Reporting bugs

Open an issue on GitHub with:
- The scenario YAML you were running
- The stepproof version (`stepproof --version`)
- The error output
- Your Node.js version (`node --version`)

## License

MIT. Contributions are accepted under the same license.
