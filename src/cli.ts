import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { executePlan } from "./executor.js";
import { extractInputs } from "./inputExtractor.js";
import { loadWorkflows, showWorkflow } from "./registry.js";
import { loadPersonalInboxConfig, runPersonalInboxWorkflow, type PersonalInboxOutput } from "./personalInbox.js";
import { listenPersonalMemoryCallbacks } from "./personalMemoryCallbacks.js";
import { routePrompt } from "./router.js";
import { buildTeacherGuide, printTeacherGuide } from "./teacher.js";
import { renderTemplate } from "./template.js";
import { handleTemplateCommand, handleTemplatePrompt } from "./templateCatalog.js";
import { spawnLarkCli } from "./larkCliProcess.js";
import type { CliFlags, ExecutionPlan, ParsedArgs, TemplateContext, WorkflowDefinition, WorkflowInput } from "./types.js";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export async function main(argv: string[]): Promise<void> {
  const { command, args, flags } = parseArgs(argv);
  const workflows = loadWorkflows(rootDir);

  if (command === "auth") {
    const authArgs = [
      ...(flags.profile ? ["--profile", flags.profile] : []),
      "auth",
      ...args,
      ...(flags.help ? ["--help"] : []),
      ...(flags.json ? ["--json"] : [])
    ];
    const result = spawnLarkCli(authArgs, { encoding: "utf8", stdio: "inherit" });
    process.exitCode = result.status ?? (result.error ? 1 : 0);
    return;
  }

  if (command === "memory") {
    const subcommand = args[0] || "";
    if (subcommand !== "listen") fail(`Unknown memory command: ${subcommand || "(missing)"}`);
    if (!flags.profile) fail("memory listen requires --profile <name>.");
    const exitCode = await listenPersonalMemoryCallbacks({
      rootDir,
      profile: flags.profile,
      maxEvents: flags.maxEvents,
      timeout: flags.timeout,
      json: flags.json
    });
    process.exitCode = exitCode;
    return;
  }

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
  if (selected.executionHandler === "personal-inbox-sync" && !hasValue(input.community_chat_ids)) {
    const saved = loadPersonalInboxConfig(rootDir, flags.profile);
    if (saved?.communityChatIds?.length) input.community_chat_ids = saved.communityChatIds.join(",");
  }
  const missingInputs = selected.requiredInputs.filter((item) => (item.required ?? true) && !hasValue(input[item.name]) && !item.default);
  if (!missingInputs.length && selected.executionHandler === "personal-inbox-sync") {
    const output = runPersonalInboxWorkflow({ rootDir, workflow: selected, input, flags });
    if (flags.json) {
      printJson(output);
    } else {
      printPersonalInboxOutput(output);
    }
    if (output.status === "needs_auth") {
      process.exitCode = 2;
    } else if (output.status === "error") {
      process.exitCode = 1;
    }
    return;
  }
  const plan = missingInputs.length
    ? buildMissingInputPlan(selected, input, flags)
    : buildPlan(rootDir, selected, input, flags);

  if (flags.json) {
    printJson({
      workflow: selected.id,
      name: selected.name,
      profile: flags.profile || null,
      status: missingInputs.length ? "needs_input" : flags.execute ? "ready_to_execute" : "dry_run",
      liveData: flags.withLiveData || flags.execute,
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
    withLiveData: false,
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
    } else if (value === "--with-live-data") {
      flags.withLiveData = true;
    } else if (value === "--help" || value === "-h") {
      flags.help = true;
    } else if (value === "--workflow") {
      flags.workflow = argv[++index];
    } else if (value === "--max-events") {
      flags.maxEvents = parsePositiveIntegerFlag("--max-events", argv[++index]);
    } else if (value.startsWith("--max-events=")) {
      flags.maxEvents = parsePositiveIntegerFlag("--max-events", value.slice("--max-events=".length));
    } else if (value === "--timeout") {
      flags.timeout = parseTimeoutFlag(argv[++index]);
    } else if (value.startsWith("--timeout=")) {
      flags.timeout = parseTimeoutFlag(value.slice("--timeout=".length));
    } else if (value === "--profile") {
      flags.profile = validateProfileName(argv[++index]);
    } else if (value.startsWith("--profile=")) {
      flags.profile = validateProfileName(value.slice("--profile=".length));
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
  console.log(`Mode: ${flags.execute ? "execute" : flags.withLiveData ? "live-data dry-run" : "dry-run"}`);
  if (flags.profile) {
    console.log(`Lark profile: ${flags.profile}`);
  }
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

function parsePositiveIntegerFlag(name: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) fail(`${name} must be an integer between 1 and 100000.`);
  return parsed;
}

function parseTimeoutFlag(value: string | undefined): string {
  const timeout = String(value || "").trim();
  if (!/^\d+(?:ms|s|m|h)$/.test(timeout)) fail("--timeout must look like 500ms, 60s, 10m, or 1h.");
  return timeout;
}

function printPersonalInboxOutput(output: PersonalInboxOutput): void {
  console.log(`Workflow: ${output.workflow} - ${output.name}`);
  console.log(`Status: ${output.status}`);
  if (output.profile) console.log(`Lark profile: ${output.profile}`);
  console.log(`Window: ${output.window.start} -> ${output.window.end}`);
  console.log(`Base: ${output.base.url || (output.base.willCreate ? "首次 --execute 时自动创建" : "已配置")}`);
  console.log("\nCounts:");
  console.log(`  collected: ${output.counts.collected}`);
  console.log(`  new: ${output.counts.new}`);
  console.log(`  updated: ${output.counts.updated}`);
  console.log(`  skipped: ${output.counts.skipped}`);
  if (output.review.card) {
    console.log("\nCard preview: Card 2.0 · 每周信息记忆卡");
    console.log(`  ${output.review.summary}`);
    if (output.review.themes.length) {
      console.log(`  主要主题：${output.review.themes.map((theme) => theme.name).join("、")}`);
    }
    if (output.review.detailPage.url) console.log(`  完整回顾：${output.review.detailPage.url}`);
    if (output.review.delivery.sent) {
      console.log(`\n互动卡片已发送给自己${output.review.delivery.messageId ? `（消息 ${output.review.delivery.messageId}）` : ""}。`);
    } else if (output.review.delivery.requested && output.status !== "dry_run") {
      console.log("\n已请求创建完整回顾页并发送互动卡片；只有数据源完整且同步成功时才会投递。");
    }
  }
  if (output.warnings.length) {
    console.log("\nWarnings:");
    for (const warning of output.warnings) console.log(`  - ${warning}`);
  }
  if (output.auth) {
    console.log("\nAuthorize the missing user scopes:");
    console.log(`  ${output.auth.command}`);
  }
  if (output.status === "dry_run") {
    console.log("\nDry-run only. Add --with-live-data to preview current activity or --execute to sync it.");
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
  larkwing run "生成本周信息足迹" --workflow personal-inbox --profile <profile> --with-live-data --json
  larkwing memory listen --profile <profile> --max-events 2 --timeout 10m --json
  larkwing auth status --profile <profile> --json
  larkwing template copy "工作日报" --set target_parent_node_token=...
  larkwing workflow list
  larkwing workflow show <id>

Options:
  --set key=value     Provide workflow input values
  --workflow <id>     Force a workflow instead of routing by prompt
  --profile <name>    Use a named lark-cli profile without changing the global active profile
  --execute           Execute generated lark-cli commands
  --dry-run           Preview only, default
  --with-live-data    Read live Feishu data during dry-run without writing online
  --max-events <n>    Stop memory listener after n card events
  --timeout <value>   Stop memory listener after a duration such as 60s or 10m
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
  if (process.platform === "win32") {
    return `'${String(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function validateProfileName(value: string | undefined): string {
  const profile = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile) || profile === "." || profile === "..") {
    fail("Invalid --profile value. Use 1-64 letters, numbers, dots, underscores, or hyphens.");
  }
  return profile;
}

function addLarkProfile(command: string, profile: string | undefined): string {
  if (!profile) return command;
  return command.replace(/^lark-cli(?=\s|$)/, `lark-cli --profile ${shellQuote(profile)}`);
}
