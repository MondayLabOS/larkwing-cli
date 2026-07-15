export interface WorkflowInput {
  name: string;
  description: string;
  default?: string;
}

export interface WorkflowArtifact {
  name: string;
  filename: string;
  template: string;
  localizedTemplates?: Record<string, string>;
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
  localizedTitleTemplates?: Record<string, string>;
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

export interface TemplateCatalogItem {
  id: string;
  title: string;
  category: string;
  type: string;
  delivery?: "wiki-copy" | "local-document";
  sourceSpaceId?: string;
  sourceNodeToken?: string;
  objType: string;
  tags?: string[];
  description?: string;
  inputs?: WorkflowInput[];
  titleTemplate?: string;
  localizedTitleTemplates?: Record<string, string>;
  filename?: string;
  content?: string;
  localizedContents?: Record<string, string>;
}

export interface TemplateCatalog {
  id: string;
  name: string;
  sourceUrl?: string;
  sourceSpaceId?: string;
  sourceNodeToken?: string;
  items: TemplateCatalogItem[];
}

export interface TeacherSuggestion {
  id: string;
  title: string;
  why: string;
  command: string;
  kind: "workflow" | "template" | "discovery";
}

export interface TeacherGuide {
  status: "needs_goal" | "suggestions";
  message: string;
  question: string;
  suggestions: TeacherSuggestion[];
}
