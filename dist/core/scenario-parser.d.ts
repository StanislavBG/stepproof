import type { Scenario } from './types.js';
export declare function parseScenario(filePath: string): Scenario;
export declare function substituteVariables(template: string, variables: Record<string, string>, stepOutputs: Record<string, string>): string;
//# sourceMappingURL=scenario-parser.d.ts.map