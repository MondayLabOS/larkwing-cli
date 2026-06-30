import type { WorkflowDefinition } from "./types.js";

export function extractInputs(prompt: string, workflow: WorkflowDefinition): Record<string, string> {
  const input: Record<string, string> = {};

  for (const item of workflow.requiredInputs) {
    const value = extractInput(prompt, workflow.id, item.name);
    if (value) {
      input[item.name] = value;
    }
  }

  return input;
}

function extractInput(prompt: string, workflowId: string, inputName: string): string | null {
  if (inputName === "week") {
    return extractWeek(prompt);
  }

  if (inputName === "source_url") {
    return extractUrl(prompt);
  }

  if (inputName === "team" && workflowId === "weekly-meeting") {
    return extractTeam(prompt);
  }

  if (inputName === "project_name") {
    return extractNamedSubject(prompt, ["项目", "project"]);
  }

  if (inputName === "topic") {
    return extractNamedSubject(prompt, ["知识库", "wiki", "文章", "文档"]);
  }

  if (inputName === "process_name") {
    return extractNamedSubject(prompt, ["SOP", "sop", "流程", "process"]);
  }

  return null;
}

function extractWeek(prompt: string): string | null {
  const explicitWeek = prompt.match(/\b(20\d{2}-W(?:0[1-9]|[1-4]\d|5[0-3]))\b/i);
  if (explicitWeek) {
    return explicitWeek[1].toUpperCase();
  }

  const explicitDate = prompt.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (explicitDate) {
    return toIsoWeek(new Date(Number(explicitDate[1]), Number(explicitDate[2]) - 1, Number(explicitDate[3])));
  }

  if (/下周|next week/i.test(prompt)) {
    return toIsoWeek(addDays(new Date(), 7));
  }

  if (/本周|这周|this week/i.test(prompt)) {
    return toIsoWeek(new Date());
  }

  return null;
}

function extractUrl(prompt: string): string | null {
  return prompt.match(/https?:\/\/\S+/)?.[0] || null;
}

function extractTeam(prompt: string): string | null {
  const beforePossessive = prompt.match(/(?:创建|生成|准备|新建|create|prepare|make)?\s*([A-Za-z][\w .-]{1,48}|[\u4e00-\u9fa5A-Za-z0-9 ._-]{2,48})\s*的\s*(?:20\d{2}-W\d{2}\s*)?(?:周会|例会|weekly meeting)/i);
  if (beforePossessive) {
    return cleanSubject(beforePossessive[1]);
  }

  const afterTeamKeyword = prompt.match(/(?:团队|team)\s*[:：为是]?\s*([A-Za-z][\w .-]{1,48}|[\u4e00-\u9fa5A-Za-z0-9 ._-]{2,48})/i);
  if (afterTeamKeyword) {
    return cleanSubject(afterTeamKeyword[1]);
  }

  const conciseBeforeMeeting = prompt.match(/([A-Za-z][\w .-]{1,48}|[\u4e00-\u9fa5A-Za-z0-9 ._-]{2,48})\s+(?:20\d{2}-W\d{2}\s*)?(?:周会|例会|weekly meeting)/i);
  if (conciseBeforeMeeting) {
    return cleanSubject(conciseBeforeMeeting[1]);
  }

  const conciseAfterMeeting = prompt.match(/(?:周会|例会|weekly meeting)\s+([A-Za-z][\w .-]{1,48}|[\u4e00-\u9fa5A-Za-z0-9 ._-]{2,48})/i);
  if (conciseAfterMeeting) {
    return cleanSubject(conciseAfterMeeting[1]);
  }

  return null;
}

function extractNamedSubject(prompt: string, anchors: string[]): string | null {
  for (const anchor of anchors) {
    const afterAnchor = prompt.match(new RegExp(`${escapeRegExp(anchor)}\\s*[：:为是]?\\s*([A-Za-z][\\w .-]{1,64}|[\\u4e00-\\u9fa5A-Za-z0-9 ._-]{2,64})`, "i"));
    if (afterAnchor) {
      return cleanSubject(afterAnchor[1]);
    }

    const beforeAnchor = prompt.match(new RegExp(`([A-Za-z][\\w .-]{1,64}|[\\u4e00-\\u9fa5A-Za-z0-9 ._-]{2,64})\\s*的\\s*${escapeRegExp(anchor)}`, "i"));
    if (beforeAnchor) {
      return cleanSubject(beforeAnchor[1]);
    }
  }

  return null;
}

function cleanSubject(value: string): string {
  const commandPrefix = /^(?:帮我|请|创建|生成|准备|新建|做|写|一份|一个|create|generate|prepare|make|write|the|a|an)\s*/i;
  return value
    .replace(commandPrefix, "")
    .replace(commandPrefix, "")
    .replace(commandPrefix, "")
    .replace(/\s*的?\s*20\d{2}-W\d{2}\s*/i, " ")
    .replace(/\s*(文档|文件|模板|周会|例会|weekly meeting document|meeting document|weekly meeting|meeting|SOP|sop)$/i, "")
    .trim();
}

function toIsoWeek(date: Date): string {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
