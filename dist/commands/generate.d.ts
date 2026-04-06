export interface GenerateOptions {
    count: number;
    output?: string;
    append: boolean;
}
/**
 * Generate synthetic edge-case test inputs for a scenario.
 * Calls Claude Haiku with a meta-prompt to produce diverse, adversarial inputs,
 * then writes them as a CSV compatible with --dataset.
 */
export declare function runGenerate(scenarioPath: string, opts: GenerateOptions): Promise<string>;
//# sourceMappingURL=generate.d.ts.map