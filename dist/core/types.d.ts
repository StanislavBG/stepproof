export type Provider = 'openai' | 'anthropic' | 'gemini' | 'ollama';
export type AssertionType = 'contains' | 'not_contains' | 'regex' | 'json_schema' | 'llm_judge' | 'similarity' | 'sentiment' | 'toxicity' | 'starts_with' | 'ends_with' | 'length' | 'word_count' | 'cost_under' | 'latency_under';
export interface ConversationTurn {
    role: 'user' | 'assistant' | 'system';
    content?: string;
}
export interface Assertion {
    type: AssertionType;
    /** For contains, not_contains, regex, starts_with, ends_with, cost_under, latency_under */
    value?: string | number;
    /** For json_schema: path to JSON schema file (relative to scenario file) */
    schema?: string;
    /** For llm_judge: the evaluation prompt */
    prompt?: string;
    /** For llm_judge: the expected response prefix (default: "yes") */
    pass_on?: string;
    /** For llm_judge, similarity, sentiment, toxicity: override provider (default: anthropic) */
    provider?: Provider;
    /** For llm_judge, similarity, sentiment, toxicity: override model */
    model?: string;
    /** For similarity: minimum similarity score 0.0-1.0 (default: 0.7) */
    threshold?: number;
    /** For toxicity: maximum toxicity score 0.0-1.0 (default: 0.5) */
    max_score?: number;
    /** For length, word_count: minimum value */
    min?: number;
    /** For length, word_count: maximum value */
    max?: number;
}
export interface Step {
    id: string;
    provider: Provider;
    model: string;
    /** Prompt template. Use {{variable}} for variables, {{step_id.output}} for prior step outputs. Required unless conversation is set. */
    prompt?: string;
    /** Optional system prompt */
    system?: string;
    /** Multi-turn conversation. The last assistant turn without content is where the LLM responds. */
    conversation?: ConversationTurn[];
    /** Step IDs this step depends on. Steps without dependencies run in parallel. */
    depends_on?: string[];
    /** Condition string — if false, step is skipped. Supports contains, not_contains, matches operators. */
    if?: string;
    /** Minimum pass rate threshold (0.0-1.0). Default: 0.8 */
    min_pass_rate?: number;
    /** Retry up to N times on assertion failure (0 = no retries). Default: 0 */
    retry?: number;
    /** Delay in ms between retries. Default: 1000 */
    retry_delay?: number;
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
    skipped?: boolean;
    /** Number of retries used before final result (0 = passed on first try) */
    retriesUsed?: number;
    /** Dataset row index (0-based) when running in dataset mode */
    datasetRow?: number;
    assertionResults: AssertionResult[];
    error?: string;
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
}
export interface StepSummary {
    stepId: string;
    totalRuns: number;
    passes: number;
    failures: number;
    passRate: number;
    minPassRate: number;
    belowThreshold: boolean;
    avgDurationMs: number;
    totalCostUsd: number;
    avgCostUsd: number;
    /** Number of step results that required at least one retry */
    retriedCount?: number;
}
/** Per-row result summary when running in dataset mode */
export interface DatasetRowSummary {
    rowIndex: number;
    /** First few columns from the row for display */
    rowPreview: Record<string, string>;
    allStepsPassed: boolean;
    stepResults: Array<{
        stepId: string;
        passed: boolean;
        passRate: number;
    }>;
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
    /** Dataset mode info — present when run with --dataset */
    dataset?: {
        path: string;
        totalRows: number;
        rowsPassed: number;
        rowSummaries: DatasetRowSummary[];
    };
}
//# sourceMappingURL=types.d.ts.map