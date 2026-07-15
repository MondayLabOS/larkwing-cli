import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

test("empty invocation is handled by Teacher Agent", () => {
  const result = runCli(["--json"]);
  assert.equal(result.status, 0);
  const guide = JSON.parse(result.stdout);
  assert.equal(guide.status, "needs_goal");
  assert.ok(guide.question);
  assert.ok(guide.suggestions.length >= 4);
});

test("Teacher Agent recommends scene-specific actions", () => {
  const result = runCli(["teacher", "客户拜访完不知道怎么跟进", "--json"]);
  assert.equal(result.status, 0);
  const guide = JSON.parse(result.stdout);
  assert.equal(guide.status, "suggestions");
  assert.equal(guide.suggestions[0].id, "customer-visit-notes");
});

test("starter kit contains exactly ten local templates", () => {
  const catalog = JSON.parse(readFileSync(join(rootDir, "templates", "everyday-work-starter-kit.json"), "utf8"));
  assert.equal(catalog.items.length, 10);
  assert.ok(catalog.items.every((item) => item.delivery === "local-document"));
});

test("local template produces a rendered artifact in dry-run mode", () => {
  const result = runCli([
    "template", "use", "weekly-priority-plan",
    "--set", "week=2026-W29",
    "--set", "owner=MondayLab",
    "--json"
  ]);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "dry_run");
  assert.equal(output.title, "2026-W29一页纸周计划");
  const artifact = readFileSync(output.artifact, "utf8");
  assert.match(artifact, /负责人：MondayLab/);
  assert.match(artifact, /本周只抓三件事/);
});

test("existing Wiki templates still use copy delivery", () => {
  const result = runCli(["template", "use", "work-daily-report", "--json"]);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "dry_run");
  assert.match(output.command, /wiki \+node-copy/);
  assert.match(output.command, /--dry-run/);
});

function runCli(args) {
  return spawnSync(process.execPath, [join(rootDir, "bin", "larkwing.js"), ...args], {
    cwd: rootDir,
    encoding: "utf8"
  });
}
