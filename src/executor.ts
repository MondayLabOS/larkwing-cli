import { spawnSync } from "node:child_process";

import type { ExecutionPlan, ExecutionResult } from "./types.js";

export function executePlan(plan: ExecutionPlan): ExecutionResult {
  const dependency = checkLarkCli();
  if (!dependency.ok) {
    console.error(dependency.message);
    return {
      ok: false,
      exitCode: 127
    };
  }

  for (const step of plan.steps) {
    console.log(`\n$ ${step.command}`);
    const result = spawnSync(step.command, {
      shell: true,
      stdio: "inherit"
    });

    if (result.status !== 0) {
      return {
        ok: false,
        exitCode: result.status || 1,
        failedStep: step.id
      };
    }
  }

  return { ok: true };
}

function checkLarkCli(): { ok: true } | { ok: false; message: string } {
  const result = spawnSync("lark-cli", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error || result.status !== 0) {
    return {
      ok: false,
      message: `larkwing-cli requires lark-cli when running with --execute.

Install lark-cli:
  npm install -g @larksuite/cli

Authenticate:
  lark-cli auth login

Update skills:
  lark-cli update

Dry-run mode still works without lark-cli:
  larkwing "prepare a weekly meeting"`
    };
  }

  return { ok: true };
}
