export type Provider = 'openai' | 'anthropic';

export type AssertionType = 'contains' | 'not_contains' | 'regex' | 'json_schema' | 'llm_judge';

export interface Assertion {
  type: AssertionType;
  /** For contains, not_contains, regex */
  value?: string;
  /** For json_schema: path to JSON schema file (relative to scenario file) */
  schema?: string;
  /** For llm_judge: the evaluation prompt */
  prompt?: string;
  /** For llm_judge: the expected response prefix (default: "yes") */
  pass_on?: string;
  /** For llm_judge: override provider (default: anthropic) */
  provider?: Provider;
  /** For llm_judge: override model (default: claude-haiku or gpt-4o-mini) */
  model?: string;
}

export interface Step {
  id: string;
  provider: Provider;
  model: string;
  /** Prompt template. Use {{variable}} for variables, {{step_id.output}} for prior step outputs. */
  prompt: string;
  /** Optional system prompt */
  system?: string;
  /** Minimum pass rate threshold (0.0–1.0). Default: 0.8 */
  min_pass_rate?: number;
  assertions: Assertion[];
}

export interface Scenario {
  name: string;
  /** Number of iterations to run. Default: 10 */
  iterations?: number;
  /** Global variables for template substitution */
  variables?: Record<string, string>;
  steps: Step[];
}

export interface AssertionResult {
  type: string;
  passed: boolean;
  message?: string;
}

export interface StepResult {
  stepId: string;
  iteration: number;
  output: string;
  passed: boolean;
  assertionResults: AssertionResult[];
  error?: string;
  durationMs: number;
}

export interface StepSummary {
  stepId: string;
  totalRuns: number;
  passes: number;
  failures: number;
  passRate: number;
  minPassRate: number;
  belowThreshold: boolean;
}

export interface ScenarioReport {
  scenarioName: string;
  iterations: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  steps: StepSummary[];
  allPassed: boolean;
  results: StepResult[];
}
