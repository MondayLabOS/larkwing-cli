import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { executePlan } from "./executor.js";
import { extractInputs } from "./inputExtractor.js";
import { loadWorkflows, showWorkflow } from "./registry.js";
import { routePrompt } from "./router.js";
import { buildTeacherGuide, printTeacherGuide } from "./teacher.js";
import { renderTemplate } from "./template.js";
import { handleTemplateCommand, handleTemplatePrompt } from "./templateCatalog.js";
import type { CliFlags, ExecutionPlan, ParsedArgs, TemplateContext, WorkflowDefinition, WorkflowInput } from "./types.js";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export async function main(argv: string[]): Promise<void> {
  const { command, args, flags } = parseArgs(argv);
  const workflows = loadWorkflows(rootDir);

  if (command === "help" || flags.help) {
    printHelp();
    return;
  }

  if (command === "workflow") {
    handleWorkflowCommand(workflows, args, flags);
    return;
  }

  if (command === "template") {
    const exitCode = handleTemplateCommand(rootDir, args, flags);
    if (exitCode) {
      process.exitCode = exitCode;
    }
    return;
  }

  if (command === "teacher" || command === "guide") {
    printTeacherGuide(buildTeacherGuide(args.join(" ")), flags.json);
    return;
  }

  const prompt = command === "run" ? args.join(" ") : [command, ...args].filter(Boolean).join(" ");
  if (!prompt) {
    printTeacherGuide(buildTeacherGuide(), flags.json);
    return;
  }

  if (!flags.workflow) {
    const templateExitCode = handleTemplatePrompt(rootDir, prompt, flags);
    if (templateExitCode !== null) {
      if (templateExitCode) {
        process.exitCode = templateExitCode;
      }
      return;
    }
  }

  const selected = flags.workflow
    ? workflows.find((workflow) => workflow.id === flags.workflow)
    : routePrompt(prompt, workflows);

  if (!selected) {
    printTeacherGuide(buildTeacherGuide(prompt), flags.json);
    return;
  }

  const input: Record<string, string> = { ...extractInputs(prompt, selected), ...parseSetFlags(flags.set), prompt };
  const missingInputs = selected.requiredInputs.filter((item) => !hasValue(input[item.name]) && !item.default);
  const plan = missingInputs.length
    ? buildMissingInputPlan(selected, input, flags)
    : buildPlan(rootDir, selected, input, flags);

  if (flags.json) {
    printJson({
      workflow: selected.id,
      name: selected.name,
      status: missingInputs.length ? "needs_input" : flags.execute ? "ready_to_execute" : "dry_run",
      missingInputs: missingInputs.map((item) => ({ name: item.name, description: item.description })),
      plan
    });
    return;
  }

  printPlan(selected, missingInputs, plan, flags);

  if (missingInputs.length) {
    process.exitCode = 2;
    return;
  }

  if (flags.execute) {
    const result = executePlan(plan);
    if (!result.ok) {
      process.exitCode = result.exitCode || 1;
    }
  }
}

function handleWorkflowCommand(workflows: WorkflowDefinition[], args: string[], flags: CliFlags): void {
  const subcommand = args[0] || "list";

  if (subcommand === "list") {
    const rows = workflows.map((workflow) => ({
      id: workflow.id,
      category: workflow.category,
      name: workflow.name,
      description: workflow.description
    }));
    if (flags.json) {
      printJson(rows);
      return;
    }
    for (const row of rows) {
      console.log(`${row.id.padEnd(24)} ${row.category.padEnd(12)} ${row.name}`);
      console.log(`  ${row.description}`);
    }
    return;
  }

  if (subcommand === "show") {
    const workflow = workflows.find((item) => item.id === args[1]);
    if (!workflow) {
      fail(`Unknown workflow: ${args[1] || ""}`);
    }
    if (flags.json) {
      printJson(workflow);
      return;
    }
    console.log(showWorkflow(workflow));
    return;
  }

  fail(`Unknown workflow command: ${subcommand}`);
}

function buildPlan(root: string, workflow: WorkflowDefinition, input: Record<string, string>, flags: CliFlags): ExecutionPlan {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const relativeRunDir = join(".larkwing", "runs", runId);
  const runDir = join(root, relativeRunDir);
  mkdirSync(runDir, { recursive: true });

  const values: Record<string, string> = {};
  for (const item of workflow.requiredInputs) {
    values[item.name] = input[item.name] ?? item.default ?? "";
  }
  values.prompt = input.prompt;
  values.language = normalizeLanguage(input.language) || detectLanguage(input.prompt);
  values.runDir = runDir;
  const titleTemplate = selectLocalizedTemplate(workflow.titleTemplate, workflow.localizedTitleTemplates, values.language);
  if (titleTemplate) {
    values.workflowTitle = renderTemplate(titleTemplate, values);
  }

  const artifacts: Record<string, string> = {};
  const artifactRefs: Record<string, string> = {};
  for (const artifact of workflow.artifacts || []) {
    const template = selectLocalizedTemplate(artifact.template, artifact.localizedTemplates, values.language);
    const rendered = renderTemplate(template, values);
    const filePath = join(runDir, artifact.filename);
    writeFileSync(filePath, rendered, "utf8");
    artifacts[artifact.name] = filePath;
    artifactRefs[artifact.name] = join(relativeRunDir, artifact.filename);
  }

  const context = buildTemplateContext(values, artifacts, artifactRefs);
  const steps = workflow.steps.map((step) => ({
    id: step.id,
    name: step.name,
    command: renderTemplate(step.command, context),
    mode: flags.execute ? "execute" as const : "dry-run" as const
  }));

  return {
    dryRun: !flags.execute,
    runDir,
    inputs: values,
    artifacts,
    steps,
    outputs: workflow.outputs || []
  };
}

function buildTemplateContext(
  values: Record<string, string>,
  artifacts: Record<string, string>,
  artifactRefs: Record<string, string>
): TemplateContext {
  const context: TemplateContext = { ...values, artifacts };
  const shell: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (key !== "shell" && key !== "artifacts") {
      shell[key] = shellQuote(value);
    }
  }

  shell.artifacts = {};
  for (const [key, value] of Object.entries(artifactRefs)) {
    (shell.artifacts as Record<string, string>)[key] = shellQuote(value);
  }

  context.shell = shell;
  return context;
}

function buildMissingInputPlan(workflow: WorkflowDefinition, input: Record<string, string>, flags: CliFlags): ExecutionPlan {
  return {
    dryRun: !flags.execute,
    runDir: null,
    inputs: input,
    artifacts: {},
    steps: [],
    outputs: workflow.outputs || []
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: string[] = [];
  const flags: CliFlags = {
    execute: false,
    json: false,
    help: false,
    set: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--execute") {
      flags.execute = true;
    } else if (value === "--dry-run") {
      flags.execute = false;
    } else if (value === "--json") {
      flags.json = true;
    } else if (value === "--help" || value === "-h") {
      flags.help = true;
    } else if (value === "--workflow") {
      flags.workflow = argv[++index];
    } else if (value === "--set") {
      flags.set.push(argv[++index]);
    } else if (value.startsWith("--set=")) {
      flags.set.push(value.slice("--set=".length));
    } else {
      args.push(value);
    }
  }

  return {
    command: args.shift() || "",
    args,
    flags
  };
}

function parseSetFlags(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of values || []) {
    const splitAt = item.indexOf("=");
    if (splitAt < 1) {
      fail(`Invalid --set value: ${item}. Expected key=value.`);
    }
    result[item.slice(0, splitAt)] = item.slice(splitAt + 1);
  }
  return result;
}

function printPlan(workflow: WorkflowDefinition, missingInputs: WorkflowInput[], plan: ExecutionPlan, flags: CliFlags): void {
  console.log(`Workflow: ${workflow.id} - ${workflow.name}`);
  console.log(`Mode: ${flags.execute ? "execute" : "dry-run"}`);
  if (plan.runDir) {
    console.log(`Run dir: ${plan.runDir}`);
  }

  if (missingInputs.length) {
    console.log("\nMissing inputs:");
    for (const item of missingInputs) {
      console.log(`  --set ${item.name}=...  ${item.description}`);
    }
    console.log("\nAdd the missing values and run again.");
    return;
  }

  if (Object.keys(plan.artifacts).length) {
    console.log("\nArtifacts:");
    for (const [name, filePath] of Object.entries(plan.artifacts)) {
      console.log(`  ${name}: ${filePath}`);
    }
  }

  console.log("\nSteps:");
  for (const [index, step] of plan.steps.entries()) {
    console.log(`  ${index + 1}. ${step.name}`);
    console.log(`     ${step.command}`);
  }

  if (!flags.execute) {
    console.log("\nDry-run only. Re-run with --execute to call lark-cli.");
  }
}

function printHelp(): void {
  console.log(`larkwing-cli

Natural-language workflow layer on top of lark-cli.

Usage:
  larkwing
  larkwing teacher "我最近事情很多，不知道先做什么"
  larkwing "prepare a weekly meeting"
  larkwing "我要一个工作日报模板"
  larkwing run "turn this meeting into tasks" --set source_url=https://...
  larkwing run "start a project" --workflow project-kickoff --set project_name=...
  larkwing template list
  larkwing template use weekly-priority-plan
  larkwing template copy "工作日报" --set target_parent_node_token=...
  larkwing workflow list
  larkwing workflow show <id>

Options:
  --set key=value     Provide workflow input values
  --workflow <id>     Force a workflow instead of routing by prompt
  --execute           Execute generated lark-cli commands
  --dry-run           Preview only, default
  --json              Return structured output for agents
`);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message: string): never {
  throw new Error(message);
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function detectLanguage(prompt: string): string {
  return /[\u3400-\u9fff]/.test(prompt) ? "zh" : "en";
}

function normalizeLanguage(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (["zh", "cn", "chinese", "中文", "简体中文"].includes(normalized)) {
    return "zh";
  }
  if (["en", "us", "uk", "english", "英文", "英语"].includes(normalized)) {
    return "en";
  }
  return null;
}

function selectLocalizedTemplate(
  fallback: string | undefined,
  localized: Record<string, string> | undefined,
  language: string
): string {
  return localized?.[language] || fallback || localized?.en || localized?.zh || "";
}

function shellQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
