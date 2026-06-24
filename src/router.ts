import type { WorkflowDefinition } from "./types.js";

export function routePrompt(prompt: string, workflows: WorkflowDefinition[]): WorkflowDefinition | null {
  const normalizedPrompt = normalize(prompt);
  const scored = workflows
    .map((workflow) => ({
      workflow,
      score: scoreWorkflow(normalizedPrompt, workflow)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  return scored[0]?.workflow || null;
}

function scoreWorkflow(prompt: string, workflow: WorkflowDefinition): number {
  let score = 0;
  for (const keyword of workflow.intents.keywords || []) {
    if (prompt.includes(normalize(keyword))) {
      score += 3;
    }
  }

  for (const example of workflow.intents.examples || []) {
    const tokens = normalize(example).split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (token.length > 1 && prompt.includes(token)) {
        score += 1;
      }
    }
  }

  return score;
}

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[，。！？、,.!?;:()[\]{}"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
