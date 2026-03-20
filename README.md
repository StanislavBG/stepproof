# stepproof

**Regression testing for multi-step AI workflows. Not observability.**

---

You upgraded to `gpt-4o-mini`. Your LangSmith traces look fine. Three days later a customer reports your extraction step stopped working. You found out from a Slack message, not a test.

stepproof is what you run before you deploy.

```bash
# Install from GitHub (npm package coming soon)
npm install -g github:StanislavBG/stepproof
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
stepproof v0.1.0 — running "Intent classification" (10 iterations)

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
      - run: npm install -g github:StanislavBG/stepproof
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

- **v0.1** (now): YAML scenarios, N iterations, 5 assertion types, exit code 1 on failure, OpenAI + Anthropic
- **v0.2**: Baseline comparison (fail on regression from last run), GitHub Actions native action, provider comparison mode
- **Cloud dashboard** (month 3–6): Persistent history, trend charts, team workspaces — never in the CLI

---

## Contributing

Issues and PRs welcome. The tool is and will remain free. Cloud features are the business model, not the CLI.

```
git clone https://github.com/StanislavBG/stepproof
cd stepproof
npm install
npm test
```

---

*stepproof — because "I checked manually before the deploy" is not a test.*

---

## Part of the Preflight suite

stepproof is one tool in a suite of AI agent pre-deploy checks:

| Tool | Purpose | Install |
|------|---------|---------|
| **stepproof** | Behavioral regression testing | `npm install -g github:StanislavBG/stepproof` |
| **agent-comply** | EU AI Act compliance scanning | `npm install -g github:StanislavBG/agent-comply` |
| **agent-gate** | Unified pre-deploy CI gate | `npm install -g github:StanislavBG/agent-gate` |
| **agent-shift** | Config versioning + environment promotion | `npm install -g github:StanislavBG/agent-shift` |

Install the full suite:
```bash
npm install -g github:StanislavBG/agent-gate github:StanislavBG/stepproof github:StanislavBG/agent-comply github:StanislavBG/agent-shift
```
