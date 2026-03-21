import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const SCENARIO_SCAFFOLD = `# stepproof scenario — edit this, then run: stepproof run ./scenarios/first-test.yaml
name: First Test
description: "Test your AI agent's response quality"
iterations: 5

steps:
  - id: step-1
    prompt: "Explain what you do in one sentence."
    threshold: 0.8     # 80% of runs must pass
    checks:
      - type: contains
        value: "AI"    # replace with text you expect in the response

# More check types: contains, not_contains, regex, length_gt, length_lt
# Full docs: https://github.com/StanislavBG/stepproof
`;

export function runInit(outputDir?: string): void {
  const dir = resolve(outputDir ?? './scenarios');
  const dest = resolve(dir, 'first-test.yaml');

  if (existsSync(dest)) {
    console.log(`Scenario already exists: ${dest}`);
    console.log('Edit it, then run: stepproof run ./scenarios/first-test.yaml');
    process.exit(0);
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(dest, SCENARIO_SCAFFOLD, 'utf-8');

  console.log(`\n✔ Created ${dest}`);
  console.log('');
  console.log('Next:');
  console.log('  1. Edit the scenario — replace the prompt and checks with your actual test');
  console.log('  2. stepproof run ./scenarios/first-test.yaml');
  console.log('');
  console.log('Add to CI: stepproof run ./scenarios/ --format sarif --output results.sarif');
  console.log('');
  console.log('Ready for a deploy gate? Try: npx agent-gate init');
}
