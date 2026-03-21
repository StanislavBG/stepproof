# stepproof

[![Part of Preflight](https://img.shields.io/badge/suite-Preflight-blue)](https://www.npmjs.com/package/@bilkobibitkov/agent-gate)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

**Regression testing for multi-step AI workflows. Not observability.**

---

You upgraded to `gpt-4o-mini`. Your LangSmith traces look fine. Three days later a customer reports your extraction step stopped working. You found out from a Slack message, not a test.

stepproof is what you run before you deploy.

```bash
npm install -g stepproof
```

---

## 30-second quickstart

Write a scenario:

```yaml
# classify.yaml
name: "Intent classification"
iterations: 10

steps:
  - id: classify
    provider: anthropic
    model: claude-sonnet-4-6
    prompt: "Classify the intent of this message: {{input}}"
    variables:
      input: "I need to cancel my subscription"
    min_pass_rate: 0.90
    assertions:
      - type: contains
        value: "cancel"
      - type: json_schema
        schema: ./schemas/intent.json

  - id: respond
    provider: openai
    model: gpt-4o
    prompt: "Given intent '{{classify.output}}', write a helpful reply to: {{input}}"
    min_pass_rate: 0.80
    assertions:
      - type: llm_judge
        prompt: "Is this response helpful and on-topic? Answer yes/no."
        pass_on: "yes"
```

Run it:

```
stepproof run classify.yaml
```

Output:

```
stepproof v0.2.0 — running "Intent classification" (10 iterations)

  step: classify
    ✓ 9/10 passed (90.0%) — threshold: 90% ✓

  step: respond
    ✓ 8/10 passed (80.0%) — threshold: 80% ✓

All steps passed. Exit 0.
```

Now break it — swap to a cheaper model, lower the pass rate. It fails:

```
  step: classify
    ✗ 5/10 passed (50.0%) — threshold: 90% ✗

1 step failed. Exit 1.
```

---

## Commands

### `stepproof run <scenario>`

Run a scenario file or directory of scenarios.

```bash
stepproof run classify.yaml
stepproof run scenarios/
stepproof run scenarios/ --format sarif --output results.sarif
stepproof run scenarios/ --format junit --output results.xml
```

Flags:
- `--format <format>` — output format: `terminal` (default), `sarif`, `junit`
- `--output <file>` — write output to file instead of stdout

### `stepproof init [dir]`

Scaffold a starter scenario in the target directory. Defaults to `./scenarios/`.

```bash
stepproof init
# Creates: ./scenarios/first-test.yaml

stepproof init my-tests
# Creates: ./my-tests/first-test.yaml
```

The generated `first-test.yaml` is a working example you can edit and run immediately.

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | For Anthropic steps | Authenticates calls to Claude models |
| `OPENAI_API_KEY` | For OpenAI steps | Authenticates calls to GPT models |

Only the keys for the providers you use in your scenarios are required.

---

## CI integration

```yaml
# .github/workflows/ai-regression.yml
name: AI regression tests
on: [push, pull_request]

jobs:
  stepproof:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g stepproof
      - run: stepproof run scenarios/classify.yaml
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Exit code 1 on regression. PR blocked. Done.

---

## Assertions

| Type | What it checks |
|------|---------------|
| `contains` | Output includes this string |
| `not_contains` | Output does not include this string |
| `regex` | Output matches this pattern |
| `json_schema` | Output is valid JSON matching this schema |
| `llm_judge` | A second LLM call evaluates the output (boolean verdict) |

---

## Structured reports (v0.2.0)

stepproof outputs machine-readable SARIF 2.1.0 and JUnit XML for CI pipeline integration.

### SARIF — GitHub Advanced Security / GitLab / Azure DevOps

```bash
# Write SARIF to stdout
stepproof run classify.yaml --format sarif

# Write SARIF to file
stepproof run classify.yaml --format sarif --output results.sarif
```

Integrate with GitHub Advanced Security:

```yaml
# .github/workflows/ai-regression.yml
- name: Run stepproof
  run: stepproof run scenarios/ --format sarif --output results.sarif

- name: Upload to GitHub Security tab
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
  if: always()
```

### JUnit XML — Jenkins / CircleCI / TeamCity

```bash
stepproof run classify.yaml --format junit
stepproof run classify.yaml --format junit --output results.xml
```

```yaml
# .github/workflows/ai-regression.yml
- name: Run stepproof
  run: stepproof run scenarios/ --format junit --output test-results.xml

- name: Publish test results
  uses: actions/upload-artifact@v4
  with:
    name: test-results
    path: test-results.xml
  if: always()
```

Default output (no `--format` flag) is unchanged — human-readable terminal output.

> **Migration note (v0.2.x → v0.3.0):** `--report` still works but is deprecated and will print a warning. Switch to `--format` at your next convenience. `--report` will be removed at v1.0.0.

---

## How this is different from LangSmith / Braintrust / Langfuse

| | stepproof | LangSmith / Braintrust |
|--|-----------|------------------------|
| When it runs | Before deploy (CI) | After deploy (production) |
| What it answers | "Is my pipeline still correct?" | "What did my pipeline do?" |
| Output | Pass/fail with exit code | Traces and dashboards |
| Use case | Regression testing | Observability |

They tell you what happened. We tell you whether to deploy.

These are different jobs. Use both.

---

## Scenarios

See [`/examples`](./examples) for copy-paste ready scenarios:
- [`simple-chain.yaml`](./examples/simple-chain.yaml) — basic prompt → response → assertion
- [`tool-calling.yaml`](./examples/tool-calling.yaml) — verify tool selection and output
- [`multi-turn.yaml`](./examples/multi-turn.yaml) — conversation with memory, verify consistency

---

## Roadmap

- **v0.2.0** (current): YAML scenarios, N iterations, 5 assertion types, exit code 1 on failure, OpenAI + Anthropic, SARIF 2.1.0 + JUnit XML reporters, `stepproof init` scaffolding
- **v0.3.0** (next): Baseline comparison (fail on regression from last run), GitHub Actions native action, provider comparison mode — run the same scenario against two models and diff the results
- **Cloud dashboard** (month 3–6): Persistent history, trend charts, team workspaces — never in the CLI

---

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for dev setup and guidelines. The tool is and will remain free. Cloud features are the business model, not the CLI.

---

## Part of the Preflight suite

stepproof is one tool in the **Preflight** AI Agent DevOps suite — local-first CLIs covering the full lifecycle from pre-deploy validation to production observability:

| Tool | Purpose | Install |
|------|---------|---------|
| **stepproof** | Behavioral regression testing | `npm install -g stepproof` |
| **agent-comply** | EU AI Act compliance scanning | `npm install -g agent-comply` |
| **agent-gate** | Unified pre-deploy CI gate | `npm install -g agent-gate` |
| **agent-shift** | Config versioning + environment promotion | `npm install -g agent-shift` |
| **agent-trace** | Local observability — OTel traces in SQLite | `npm install -g agent-trace` |

Install the full suite:
```bash
npm install -g agent-gate stepproof agent-comply agent-shift agent-trace
```

---

*stepproof — because "I checked manually before the deploy" is not a test.*

---

## Legal

- [Privacy Policy](https://stanislavbg.github.io/preflight/privacy.html)
- [Terms of Service](https://stanislavbg.github.io/preflight/terms.html)
- Contact: [bilko@bglabs.app](mailto:bilko@bglabs.app)
