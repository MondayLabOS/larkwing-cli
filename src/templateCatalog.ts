import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { CliFlags, TemplateCatalog, TemplateCatalogItem } from "./types.js";

export function loadTemplateCatalogs(rootDir: string): TemplateCatalog[] {
  const templatesDir = join(rootDir, "templates");
  return readdirSync(templatesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(templatesDir, file), "utf8")) as TemplateCatalog)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function handleTemplateCommand(rootDir: string, args: string[], flags: CliFlags): number {
  const catalogs = loadTemplateCatalogs(rootDir);
  const subcommand = args[0] || "list";

  if (subcommand === "list") {
    printTemplateList(allItems(catalogs), flags);
    return 0;
  }

  if (subcommand === "search") {
    const query = args.slice(1).join(" ");
    const matches = searchTemplates(allItems(catalogs), query);
    printTemplateList(matches, flags);
    return matches.length ? 0 : 2;
  }

  if (subcommand === "show") {
    const item = findTemplate(allItems(catalogs), args.slice(1).join(" "));
    if (!item) {
      console.error(`Template not found: ${args.slice(1).join(" ")}`);
      return 2;
    }
    printTemplate(item, flags);
    return 0;
  }

  if (subcommand === "copy") {
    const targetParent = findSetValue(flags.set, "target_parent_node_token") || findSetValue(flags.set, "targetParentNodeToken");
    const targetSpace = findSetValue(flags.set, "target_space_id") || findSetValue(flags.set, "targetSpaceId") || "my_library";
    const title = findSetValue(flags.set, "title");
    const item = findTemplate(allItems(catalogs), args.slice(1).join(" "));
    if (!item) {
      console.error(`Template not found: ${args.slice(1).join(" ")}`);
      return 2;
    }
    return copyTemplate(item, { targetParent, targetSpace, title, execute: flags.execute, json: flags.json });
  }

  console.error(`Unknown template command: ${subcommand}`);
  return 2;
}

export function handleTemplatePrompt(rootDir: string, prompt: string, flags: CliFlags): number | null {
  const catalogs = loadTemplateCatalogs(rootDir);
  if (!looksLikeTemplateRequest(prompt)) {
    return null;
  }

  const items = allItems(catalogs);
  const matches = searchTemplates(items, prompt);
  if (!matches.length) {
    return null;
  }

  const topScore = scoreTemplate(matches[0], normalize(prompt));
  const closeMatches = matches.filter((item) => topScore - scoreTemplate(item, normalize(prompt)) <= 2);
  if (closeMatches.length > 1) {
    if (flags.json) {
      console.log(JSON.stringify({ status: "needs_selection", candidates: closeMatches.slice(0, 5) }, null, 2));
    } else {
      console.log("我找到了多个可能的模板，请说得更具体一点，或用下面的 id：");
      printTemplateList(closeMatches.slice(0, 5), flags);
    }
    return 2;
  }

  const targetParent = findSetValue(flags.set, "target_parent_node_token") || findSetValue(flags.set, "targetParentNodeToken");
  const targetSpace = findSetValue(flags.set, "target_space_id") || findSetValue(flags.set, "targetSpaceId") || "my_library";
  const title = findSetValue(flags.set, "title");
  return copyTemplate(matches[0], { targetParent, targetSpace, title, execute: flags.execute, json: flags.json });
}

function allItems(catalogs: TemplateCatalog[]): TemplateCatalogItem[] {
  return catalogs.flatMap((catalog) => catalog.items);
}

function searchTemplates(items: TemplateCatalogItem[], query: string): TemplateCatalogItem[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return items;
  }
  return items
    .map((item) => ({ item, score: scoreTemplate(item, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title))
    .map((entry) => entry.item);
}

function findTemplate(items: TemplateCatalogItem[], value: string): TemplateCatalogItem | null {
  const query = normalize(value);
  if (!query) {
    return null;
  }
  return items.find((item) => normalize(item.id) === query) || searchTemplates(items, value)[0] || null;
}

function scoreTemplate(item: TemplateCatalogItem, query: string): number {
  let score = 0;
  const haystacks = [item.id, item.title, item.category, item.type, item.description || "", ...(item.tags || [])].map(normalize);
  for (const value of haystacks) {
    if (value === query) {
      score += 20;
    } else if (value.includes(query)) {
      score += 8;
    } else if (value.length > 1 && query.includes(value)) {
      score += 8;
    }
  }
  for (const token of query.split(/\s+/).filter(Boolean)) {
    for (const value of haystacks) {
      if (value.includes(token)) {
        score += 1;
      }
    }
  }
  return score;
}

function looksLikeTemplateRequest(prompt: string): boolean {
  const normalized = normalize(prompt);
  const intentWords = [
    "模板",
    "范本",
    "表格",
    "表",
    "清单",
    "记录表",
    "日报",
    "月报",
    "okr",
    "简历",
    "分镜",
    "投递",
    "复制",
    "给我一个",
    "我要一个",
    "来一个",
    "template",
    "tracker",
    "checklist",
    "resume",
    "storyboard"
  ];
  return intentWords.some((word) => normalized.includes(normalize(word)));
}

function printTemplateList(items: TemplateCatalogItem[], flags: CliFlags): void {
  if (flags.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  for (const item of items) {
    console.log(`${item.id.padEnd(32)} ${item.category.padEnd(14)} ${item.objType.padEnd(8)} ${item.title}`);
  }
}

function printTemplate(item: TemplateCatalogItem, flags: CliFlags): void {
  if (flags.json) {
    console.log(JSON.stringify(item, null, 2));
    return;
  }
  console.log(`${item.id} - ${item.title}`);
  console.log(`Category: ${item.category}`);
  console.log(`Type: ${item.type}`);
  console.log(`Object: ${item.objType}`);
  console.log(`Source node: ${item.sourceNodeToken}`);
  if (item.description) {
    console.log(`Description: ${item.description}`);
  }
}

function buildCopyCommand(
  item: TemplateCatalogItem,
  options: { targetParent?: string; targetSpace?: string; title?: string; execute: boolean }
): string {
  const parts = [
    "lark-cli",
    "wiki",
    "+node-copy",
    "--as",
    "user",
    "--space-id",
    shellQuote(item.sourceSpaceId),
    "--node-token",
    shellQuote(item.sourceNodeToken),
    "--format",
    "json"
  ];
  if (options.targetParent) {
    parts.push("--target-parent-node-token", shellQuote(options.targetParent));
  }
  if (options.targetSpace) {
    parts.push("--target-space-id", shellQuote(options.targetSpace));
  }
  if (options.title) {
    parts.push("--title", shellQuote(options.title));
  }
  parts.push(options.execute ? "--yes" : "--dry-run");
  return parts.join(" ");
}

function copyTemplate(
  item: TemplateCatalogItem,
  options: { targetParent?: string; targetSpace: string; title?: string; execute: boolean; json: boolean }
): number {
  const command = buildCopyCommand(item, options);
  const target = options.targetParent
    ? { target_parent_node_token: options.targetParent }
    : { target_space_id: options.targetSpace };

  if (options.json) {
    console.log(JSON.stringify({
      status: options.execute ? "ready_to_execute" : "dry_run",
      template: item,
      target,
      command
    }, null, 2));
  } else {
    console.log(`Template: ${item.title}`);
    console.log(`Target: ${options.targetParent ? options.targetParent : options.targetSpace}`);
    console.log(`Mode: ${options.execute ? "execute" : "dry-run"}`);
    console.log(`\n$ ${command}`);
  }
  if (!options.execute) {
    return 0;
  }
  return runCommand(command);
}

function runCommand(command: string): number {
  const result = spawnSync(command, { shell: true, stdio: "inherit" });
  return result.status || 0;
}

function findSetValue(values: string[], key: string): string | undefined {
  const prefix = `${key}=`;
  return values.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[，。！？、,.!?;:()[\]{}"'·｜|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shellQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
