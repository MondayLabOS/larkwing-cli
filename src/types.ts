export interface WorkflowInput {
  name: string;
  description: string;
  default?: string;
}

export interface WorkflowArtifact {
  name: string;
  filename: string;
  template: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  command: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  titleTemplate?: string;
  intents: {
    keywords?: string[];
    examples: string[];
  };
  requiredInputs: WorkflowInput[];
  artifacts?: WorkflowArtifact[];
  steps: WorkflowStep[];
  outputs?: string[];
}

export interface CliFlags {
  execute: boolean;
  json: boolean;
  help: boolean;
  workflow?: string;
  set: string[];
}

export interface ParsedArgs {
  command: string;
  args: string[];
  flags: CliFlags;
}

export type TemplateContext = Record<string, unknown>;

export interface ExecutionStep {
  id: string;
  name: string;
  command: string;
  mode: "execute" | "dry-run";
}

export interface ExecutionPlan {
  dryRun: boolean;
  runDir: string | null;
  inputs: Record<string, string>;
  artifacts: Record<string, string>;
  steps: ExecutionStep[];
  outputs: string[];
}

export interface ExecutionResult {
  ok: boolean;
  exitCode?: number;
  failedStep?: string;
}
