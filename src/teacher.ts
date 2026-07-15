import type { TeacherGuide, TeacherSuggestion } from "./types.js";

interface Scene {
  keywords: string[];
  suggestions: TeacherSuggestion[];
}

const DISCOVERY_SUGGESTIONS: TeacherSuggestion[] = [
  {
    id: "plan-my-week",
    title: "先把这周理清楚",
    why: "适合事情很多，但还没想好先做什么。",
    command: "larkwing template use weekly-priority-plan",
    kind: "template"
  },
  {
    id: "prepare-a-meeting",
    title: "准备一次会议",
    why: "从议程、讨论重点和行动项开始。",
    command: "larkwing \"准备本周周会\" --set team=团队",
    kind: "workflow"
  },
  {
    id: "start-a-project",
    title: "启动一个新项目",
    why: "把目标、负责人、里程碑和风险放到一页里。",
    command: "larkwing run \"启动项目\" --workflow project-kickoff --set project_name=项目名 --set owner=负责人",
    kind: "workflow"
  },
  {
    id: "organize-existing-material",
    title: "整理已有材料",
    why: "如果手上已经有会议纪要或文档链接，可以直接转成行动项。",
    command: "larkwing \"把这份会议纪要变成行动项 https://example.feishu.cn/docx/xxx\"",
    kind: "workflow"
  },
  {
    id: "browse-examples",
    title: "先逛逛现成模板",
    why: "还没有具体目标时，先从真实工作场景里找灵感。",
    command: "larkwing template list",
    kind: "discovery"
  }
];

const SCENES: Scene[] = [
  {
    keywords: ["周会", "开会", "会议", "纪要", "讨论", "meeting", "agenda"],
    suggestions: [
      suggestion("weekly-meeting", "准备周会", "先搭好议程、进展、阻塞和行动项。", "larkwing \"准备本周周会\" --set team=团队", "workflow"),
      suggestion("meeting-decision-log", "记录会议决策", "适合边开会边记结论和负责人。", "larkwing template use meeting-decision-log", "template"),
      suggestion("meeting-to-actions", "纪要转行动项", "适合已经有飞书纪要或文档链接。", "larkwing \"把会议纪要变成行动项 <飞书链接>\"", "workflow")
    ]
  },
  {
    keywords: ["项目", "需求", "进度", "延期", "交接", "project", "handover"],
    suggestions: [
      suggestion("project-kickoff", "启动项目", "把目标、边界、里程碑和责任人一次说清。", "larkwing run \"启动项目\" --workflow project-kickoff --set project_name=项目名 --set owner=负责人", "workflow"),
      suggestion("project-progress-brief", "汇报项目进度", "用红黄绿状态说清进展、风险和下一步。", "larkwing template use project-progress-brief", "template"),
      suggestion("work-handover-checklist", "做工作交接", "避免账号、文件、联系人和遗留事项漏交。", "larkwing template use work-handover-checklist", "template")
    ]
  },
  {
    keywords: ["忙", "安排", "计划", "优先级", "日报", "同步", "今天", "本周", "plan", "priority"],
    suggestions: [
      suggestion("weekly-priority-plan", "排本周优先级", "只保留三件最重要的事，并提前识别风险。", "larkwing template use weekly-priority-plan", "template"),
      suggestion("daily-team-update", "写每日工作同步", "用完成、计划、阻塞三段式快速同步。", "larkwing template use daily-team-update", "template")
    ]
  },
  {
    keywords: ["客户", "拜访", "销售", "需求沟通", "customer", "client", "sales"],
    suggestions: [
      suggestion("customer-visit-notes", "记录客户拜访", "把客户原话、需求、异议和下一步集中记录。", "larkwing template use customer-visit-notes", "template")
    ]
  },
  {
    keywords: ["新人", "入职", "带教", "培训", "onboarding"],
    suggestions: [
      suggestion("new-hire-30-day-plan", "制定新人 30 天计划", "按第一天、第一周和第一个月拆解上手目标。", "larkwing template use new-hire-30-day-plan", "template")
    ]
  },
  {
    keywords: ["复盘", "总结", "没做好", "回顾", "retro", "review"],
    suggestions: [
      suggestion("four-question-retrospective", "做一次轻量复盘", "用结果、亮点、问题、改进四问快速收口。", "larkwing template use four-question-retrospective", "template")
    ]
  },
  {
    keywords: ["内容", "发布", "公众号", "视频", "文章", "运营", "content", "publish"],
    suggestions: [
      suggestion("content-publish-checklist", "发布内容前检查", "覆盖标题、素材、链接、版权和发布后复查。", "larkwing template use content-publish-checklist", "template"),
      suggestion("knowledge-article", "沉淀知识库文章", "把经验整理成团队可复用的操作文档。", "larkwing run \"创建知识库文章\" --workflow knowledge-article --set topic=主题", "workflow")
    ]
  },
  {
    keywords: ["报销", "发票", "差旅", "费用", "reimbursement", "expense"],
    suggestions: [
      suggestion("expense-reimbursement-checklist", "整理报销材料", "按票据、审批、行程和金额逐项检查。", "larkwing template use expense-reimbursement-checklist", "template")
    ]
  }
];

export function buildTeacherGuide(prompt = ""): TeacherGuide {
  const normalized = normalize(prompt);
  if (!normalized) {
    return discoveryGuide();
  }

  const matched = SCENES
    .map((scene) => ({ scene, score: scene.keywords.filter((keyword) => normalized.includes(normalize(keyword))).length }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .flatMap((entry) => entry.scene.suggestions);

  const suggestions = uniqueSuggestions(matched).slice(0, 4);
  if (isGoalFreePrompt(normalized) && suggestions.length) {
    return {
      status: "suggestions",
      message: "还没想好很正常。我先利用你已经提到的场景，给几个能马上开始的入口。",
      question: "先选一个最接近的试试看；你不需要一次把完整目标想清楚。",
      suggestions
    };
  }
  if (!suggestions.length) {
    if (isGoalFreePrompt(normalized)) {
      return discoveryGuide();
    }
    return {
      status: "needs_goal",
      message: `我听到了一些线索：“${prompt.trim()}”，但还不足以判断你想要的产出。`,
      question: "做完这件事以后，你希望拿到什么：一份文档、一张清单、一个任务计划，还是整理好的会议行动项？",
      suggestions: DISCOVERY_SUGGESTIONS.slice(0, 3)
    };
  }

  return {
    status: "suggestions",
    message: "我先按你描述的场景，挑了几个最容易开始的入口。",
    question: "选一个最接近的直接执行；如果都不对，再补一句你希望最终得到什么。",
    suggestions
  };
}

function discoveryGuide(): TeacherGuide {
  return {
    status: "needs_goal",
    message: "没关系，不需要先想好一个完整目标。先从你最近最想省时间的一件事开始。",
    question: "你现在更想处理哪一类事情：安排工作、开会、推进项目、整理材料，还是先看看例子？",
    suggestions: DISCOVERY_SUGGESTIONS
  };
}

export function printTeacherGuide(guide: TeacherGuide, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(guide, null, 2));
    return;
  }

  console.log("Teacher Agent");
  console.log(`\n${guide.message}`);
  console.log(`\n${guide.question}`);
  for (const [index, item] of guide.suggestions.entries()) {
    console.log(`\n${index + 1}. ${item.title}`);
    console.log(`   ${item.why}`);
    console.log(`   $ ${item.command}`);
  }
  console.log("\n继续描述也可以：larkwing teacher \"我最近总被周会和项目汇报打断\"");
}

function suggestion(
  id: string,
  title: string,
  why: string,
  command: string,
  kind: TeacherSuggestion["kind"]
): TeacherSuggestion {
  return { id, title, why, command, kind };
}

function uniqueSuggestions(items: TeacherSuggestion[]): TeacherSuggestion[] {
  return items.filter((item, index) => items.findIndex((candidate) => candidate.id === item.id) === index);
}

function isGoalFreePrompt(prompt: string): boolean {
  return ["不知道", "没目标", "没有目标", "没想好", "随便看看", "不会用", "怎么用", "help", "start"].some((value) =>
    prompt.includes(value)
  );
}

function normalize(value: string): string {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}
