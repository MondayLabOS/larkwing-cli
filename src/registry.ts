import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { WorkflowDefinition } from "./types.js";

export function loadWorkflows(rootDir: string): WorkflowDefinition[] {
  const workflowsDir = join(rootDir, "workflows");
  return readdirSync(workflowsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(workflowsDir, file), "utf8")) as WorkflowDefinition)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function showWorkflow(workflow: WorkflowDefinition): string {
  const lines = [
    `${workflow.id} - ${workflow.name}`,
    "",
    workflow.description,
    "",
    `Category: ${workflow.category}`,
    "",
    "Intent examples:"
  ];

  for (const item of workflow.intents.examples) {
    lines.push(`  - ${item}`);
  }

  lines.push("", "Required inputs:");
  for (const item of workflow.requiredInputs) {
    lines.push(`  - ${item.name}: ${item.description}`);
  }

  lines.push("", "Steps:");
  for (const step of workflow.steps) {
    lines.push(`  - ${step.name}`);
  }

  return lines.join("\n");
}
