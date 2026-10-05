import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { spawnLarkCli } from "./larkCliProcess.js";
import type { CliFlags, WorkflowDefinition } from "./types.js";

type JsonRecord = Record<string, unknown>;

export type InboxBehavior =
  | "发出消息"
  | "收到私聊"
  | "被提及"
  | "收藏消息"
  | "社群发现"
  | "打开文档"
  | "编辑文档"
  | "评论文档";

export type InboxSection = "我的足迹" | "社群发现";
export type InboxSignalStrength = "主动" | "直接相关" | "辅助" | "候选";

export interface PersonalInboxActivity {
  eventKey: string;
  title: string;
  activityTime: string;
  contentTime: string;
  behaviors: InboxBehavior[];
  section: InboxSection;
  signalStrength: InboxSignalStrength;
  topic: string;
  sourceType: "私聊" | "群聊" | "文档";
  sourceName: string;
  sender: string;
  summary: string;
  sourceId: string;
  evidenceId: string;
  sourceUrl: string;
  status: "待整理" | "仅记录";
}

export interface WeeklyMemoryHighlight {
  eventKey: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
  section: InboxSection;
  recordId?: string;
  kept?: boolean;
  keptAt?: string;
}

export interface WeeklyMemoryTheme {
  name: string;
  count: number;
  personalCount: number;
  communityCount: number;
  highlights: WeeklyMemoryHighlight[];
}

export interface WeeklyMemoryReview {
  reviewKey: string;
  title: string;
  summary: string;
  personalCount: number;
  communityCount: number;
  communitySourceCount: number;
  themes: WeeklyMemoryTheme[];
  personalHighlights: WeeklyMemoryHighlight[];
  communityDiscoveries: WeeklyMemoryHighlight[];
  markdown: string;
  card: JsonRecord;
  detailPage: { requested: boolean; created: boolean; url?: string; documentId?: string };
  delivery: { requested: boolean; sent: boolean; format: "interactive_card"; messageId?: string };
}

export interface PersonalInboxConfig {
  schemaVersion: 1;
  profile?: string;
  baseToken: string;
  tableId: string;
  baseUrl: string;
  initialized: boolean;
  keepViewId?: string;
  communityChatIds?: string[];
  communityChats?: Array<{ chatId: string; name: string }>;
  lastSuccessfulSync?: string;
}

export interface PersonalInboxOutput {
  workflow: "personal-inbox";
  name: string;
  profile?: string;
  status: "dry_run" | "live_preview" | "complete" | "partial" | "needs_auth" | "error";
  liveData: boolean;
  window: { start: string; end: string; lookbackDays: number; incremental: boolean };
  base: {
    configured: boolean;
    created: boolean;
    willCreate: boolean;
    url?: string;
    tableId?: string;
  };
  counts: { collected: number; new: number; updated: number; skipped: number };
  warnings: string[];
  evidence: {
    sources: string[];
    byBehavior: Record<string, number>;
    bySection: Record<string, number>;
    truncatedSources: string[];
  };
  review: WeeklyMemoryReview;
  plan: string[];
  auth?: { missingScopes: string[]; command: string };
}

export type PersonalInboxCommandRunner = (args: string[], label: string) => JsonRecord;

interface SyncOptions {
  rootDir: string;
  workflow: WorkflowDefinition;
  input: Record<string, string>;
  flags: CliFlags;
  runner?: PersonalInboxCommandRunner;
  now?: Date;
}

interface CollectionResult {
  activities: PersonalInboxActivity[];
  warnings: string[];
  truncatedSources: string[];
}

export interface PersonalMemoryRecord {
  recordId: string;
  eventKey: string;
  behaviors: string[];
  section: string;
  signalStrength: string;
  topic: string;
  activityTime: string;
  contentTime: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceName: string;
  sender: string;
  sourceId: string;
  evidenceId: string;
  sourceUrl: string;
  kept: boolean;
  keptAt: string;
}

interface CommandFailure extends Error {
  envelope?: JsonRecord;
  exitCode?: number;
}

class AuthenticationRequiredError extends Error {
  constructor(public readonly command: string) {
    super(`飞书用户身份未登录或验证失败，请先运行 ${command}。`);
    this.name = "AuthenticationRequiredError";
  }
}

const CONFIG_VERSION = 1 as const;
const CONFIG_FILENAME = "personal-inbox.json";
const BASE_NAME = "个人信息记忆";
const TABLE_NAME = "记忆索引";
const TIME_ZONE = "Asia/Shanghai";
const SUMMARY_LIMIT = 240;
const MESSAGE_SEGMENT_LIMIT = 10;
const DRIVE_PAGE_LIMIT = 250;
const BASE_PAGE_LIMIT = 500;

const REQUIRED_SCOPES = [
  "search:message",
  "im:feed.flag:read",
  "im:message.group_msg:get_as_user",
  "im:message.p2p_msg:get_as_user",
  "search:docs:read",
  "base:app:create",
  "base:app:read",
  "base:field:create",
  "base:field:read",
  "base:record:create",
  "base:record:read",
  "base:record:update",
  "base:table:read",
  "base:view:read",
  "base:view:write_only"
];

const FIELD_DEFINITIONS: JsonRecord[] = [
  { type: "text", name: "活动" },
  { type: "datetime", name: "活动时间", style: { format: "yyyy-MM-dd HH:mm" } },
  { type: "datetime", name: "内容时间", style: { format: "yyyy-MM-dd HH:mm" } },
  {
    type: "select",
    name: "行为",
    multiple: true,
    options: ["发出消息", "收到私聊", "被提及", "收藏消息", "社群发现", "打开文档", "编辑文档", "评论文档"].map((name) => ({ name }))
  },
  {
    type: "select",
    name: "收件区",
    multiple: false,
    options: ["我的足迹", "社群发现"].map((name) => ({ name }))
  },
  {
    type: "select",
    name: "信号强度",
    multiple: false,
    options: ["主动", "直接相关", "辅助", "候选"].map((name) => ({ name }))
  },
  { type: "text", name: "主题" },
  {
    type: "select",
    name: "来源类型",
    multiple: false,
    options: ["私聊", "群聊", "文档"].map((name) => ({ name }))
  },
  { type: "text", name: "来源名称" },
  { type: "text", name: "发送人" },
  { type: "text", name: "内容摘要" },
  { type: "text", name: "来源ID" },
  { type: "text", name: "证据ID" },
  { type: "text", name: "来源链接", style: { type: "url" } },
  {
    type: "select",
    name: "处理状态",
    multiple: false,
    options: ["待整理", "仅记录", "已转任务", "已归档", "忽略"].map((name) => ({ name }))
  },
  { type: "text", name: "事件键" },
  { type: "datetime", name: "同步时间", style: { format: "yyyy-MM-dd HH:mm" } },
  { type: "checkbox", name: "是否重点" },
  { type: "datetime", name: "保留时间", style: { format: "yyyy-MM-dd HH:mm" } }
];

const WRITABLE_FIELDS = [
  "活动",
  "活动时间",
  "内容时间",
  "行为",
  "收件区",
  "信号强度",
  "主题",
  "来源类型",
  "来源名称",
  "发送人",
  "内容摘要",
  "来源ID",
  "证据ID",
  "来源链接",
  "处理状态",
  "事件键",
  "同步时间"
];

const SYSTEM_UPDATE_FIELDS = WRITABLE_FIELDS.filter((field) => field !== "处理状态");
const VISIBLE_FIELDS = [...WRITABLE_FIELDS, "是否重点", "保留时间"];

const VIEW_DEFINITIONS = [
  { name: "全部记忆", filter: { conditions: [] }, sortField: "活动时间" },
  { name: "我的足迹", filter: { logic: "and", conditions: [["收件区", "intersects", ["我的足迹"]]] }, sortField: "活动时间" },
  { name: "社群发现", filter: { logic: "and", conditions: [["收件区", "intersects", ["社群发现"]]] }, sortField: "活动时间" },
  { name: "待确认", filter: { logic: "and", conditions: [["处理状态", "intersects", ["待整理"]]] }, sortField: "活动时间" },
  { name: "主动记忆", filter: { logic: "and", conditions: [["信号强度", "intersects", ["主动", "直接相关"]]] }, sortField: "活动时间" },
  { name: "保留重点", filter: { logic: "and", conditions: [["是否重点", "==", true]] }, sortField: "保留时间" }
];

export function runPersonalInboxWorkflow(options: SyncOptions): PersonalInboxOutput {
  const profile = normalizeProfileName(options.flags.profile);
  const rawRunner = options.runner || runLarkCommand;
  const runner: PersonalInboxCommandRunner = profile
    ? (args, label) => rawRunner(["--profile", profile, ...args], label)
    : rawRunner;
  const now = options.now || new Date();
  const lookbackDays = normalizeLookbackDays(options.input.lookback_days);
  const initialConfig = loadConfig(options.rootDir, profile);
  const explicitCommunityChatIds = parseCsv(options.input.community_chat_ids);
  const communityChatIds = explicitCommunityChatIds.length
    ? explicitCommunityChatIds
    : (initialConfig?.communityChatIds || []);
  const communityKeywords = parseCsv(options.input.community_keywords);
  const deliverReview = normalizeBoolean(options.input.deliver_review, false);
  const reviewParentToken = options.input.review_parent_token?.trim() || "";
  const memoryHomeUrl = options.input.memory_home_url?.trim() || "";
  const communitySettingsUrl = options.input.community_settings_url?.trim() || "";
  const requiredScopes = deliverReview
    ? unique([...REQUIRED_SCOPES, "docx:document:create", "im:message", "im:message.send_as_user"])
    : REQUIRED_SCOPES;
  const window = buildSyncWindow(now, lookbackDays, initialConfig?.lastSuccessfulSync);
  const baseState = {
    configured: Boolean(initialConfig),
    created: false,
    willCreate: !initialConfig,
    ...(initialConfig?.baseUrl ? { url: initialConfig.baseUrl } : {}),
    ...(initialConfig?.tableId ? { tableId: initialConfig.tableId } : {})
  };
  const baseOutput: PersonalInboxOutput = {
    workflow: "personal-inbox",
    name: options.workflow.name,
    ...(profile ? { profile } : {}),
    status: "dry_run",
    liveData: options.flags.withLiveData || options.flags.execute,
    window,
    base: baseState,
    counts: { collected: 0, new: 0, updated: 0, skipped: 0 },
    warnings: [],
    evidence: {
      sources: ["我的主动消息与直接相关消息", "当前收藏", "编辑/评论过的云文档", "社群中的简报、文档与活动", "打开记录（仅作辅助证据）"],
      byBehavior: {},
      bySection: {},
      truncatedSources: []
    },
    review: buildWeeklyMemoryReview([], window, deliverReview, { memoryHomeUrl, communitySettingsUrl }),
    plan: [
      "使用用户身份读取个人足迹，并从群聊中筛选明确的信息载体与活动通知",
      initialConfig ? "读取现有个人信息记忆并按内容对象增量去重" : "首次执行时创建个人信息记忆 Base、字段和五个视图",
      "生成按主题组织的“本周信息足迹”，写入长期记忆索引且不覆盖人工处理状态",
      deliverReview ? "创建完整回顾页，并把 Card 2.0“每周信息记忆卡”发送给自己" : "仅预览卡片；deliver_review=true 时才创建回顾页并发送"
    ]
  };

  if (!baseOutput.liveData) {
    return baseOutput;
  }

  let identity: { openId: string; scopes: Set<string> };
  try {
    identity = readUserIdentity(runner, profile, requiredScopes);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      baseOutput.status = "needs_auth";
      baseOutput.warnings.push(error.message);
      baseOutput.auth = { missingScopes: [], command: error.command };
      return baseOutput;
    }
    return failureOutput(baseOutput, "error", error);
  }
  const missingScopes = requiredScopes.filter((scope) => !identity.scopes.has(scope));
  if (missingScopes.length) {
    baseOutput.status = "needs_auth";
    baseOutput.warnings.push(`缺少用户权限：${missingScopes.join("、")}`);
    baseOutput.auth = {
      missingScopes,
      command: authLoginCommand(profile, missingScopes)
    };
    return baseOutput;
  }

  const collection = collectActivities(
    runner,
    identity.openId,
    window,
    now,
    communityChatIds,
    communityKeywords
  );
  baseOutput.counts.collected = collection.activities.length;
  baseOutput.warnings.push(...collection.warnings);
  baseOutput.evidence.truncatedSources = collection.truncatedSources;
  baseOutput.evidence.byBehavior = countByBehavior(collection.activities);
  baseOutput.evidence.bySection = countBySection(collection.activities);
  baseOutput.review = buildWeeklyMemoryReview(collection.activities, window, deliverReview, {
    memoryHomeUrl,
    communitySettingsUrl
  });

  if (!options.flags.execute) {
    if (initialConfig) {
      try {
        const existing = listExistingRecords(runner, initialConfig);
        const diff = diffActivities(collection.activities, existing);
        baseOutput.counts = { collected: collection.activities.length, ...diff.counts };
      } catch (error) {
        baseOutput.warnings.push(`无法读取现有收件箱，预览按全部新增计算：${errorMessage(error)}`);
        baseOutput.counts.new = collection.activities.length;
      }
    } else {
      baseOutput.counts.new = collection.activities.length;
    }
    baseOutput.status = collection.warnings.length || collection.truncatedSources.length ? "partial" : "live_preview";
    return baseOutput;
  }

  let config = initialConfig;
  try {
    if (!config) {
      config = createBase(runner, options.rootDir, profile);
      baseOutput.base.created = true;
      baseOutput.base.configured = true;
      baseOutput.base.willCreate = false;
      baseOutput.base.url = config.baseUrl;
      baseOutput.base.tableId = config.tableId;
    }
    config = ensureBaseInitialized(runner, options.rootDir, config, profile);
    if (explicitCommunityChatIds.length) {
      config.communityChatIds = explicitCommunityChatIds;
      saveConfig(options.rootDir, config, profile);
    }
    const existing = listExistingRecords(runner, config);
    const diff = diffActivities(collection.activities, existing);
    baseOutput.counts = { collected: collection.activities.length, ...diff.counts };
    writeNewActivities(runner, config, diff.creates, now);
    writeUpdatedActivities(runner, config, diff.updates, now);
    const refreshedRecords = listExistingRecords(runner, config);
    bindWeeklyReviewRecords(baseOutput.review, refreshedRecords);

    const collectionComplete = collection.warnings.length === 0 && collection.truncatedSources.length === 0;
    if (collectionComplete) {
      config.lastSuccessfulSync = window.end;
      saveConfig(options.rootDir, config, profile);
      baseOutput.status = "complete";
    } else {
      baseOutput.status = "partial";
      baseOutput.warnings.push("本次存在未完成的数据源，同步游标未推进；下次运行会重新读取并去重。");
    }
    if (deliverReview && collectionComplete) {
      try {
        const page = createWeeklyReviewPage(runner, baseOutput.review, reviewParentToken);
        baseOutput.review.detailPage = { requested: true, created: true, ...page };
        baseOutput.review.card = buildWeeklyMemoryCard(baseOutput.review, {
          detailPageUrl: page.url,
          memoryHomeUrl,
          communitySettingsUrl,
          ownerOpenId: identity.openId,
          keepViewUrl: buildKeepViewUrl(config)
        });
        const messageId = deliverWeeklyReviewCard(runner, identity.openId, baseOutput.review, window, options.rootDir, profile);
        baseOutput.review.delivery = {
          requested: true,
          sent: true,
          format: "interactive_card",
          ...(messageId ? { messageId } : {})
        };
      } catch (error) {
        baseOutput.status = "partial";
        baseOutput.warnings.push(`本周信息足迹已生成并完成后台索引，但回顾页或卡片交付失败：${errorMessage(error)}`);
      }
    }
    return baseOutput;
  } catch (error) {
    baseOutput.status = "partial";
    baseOutput.warnings.push(`Base 初始化或写入未全部完成：${errorMessage(error)}`);
    baseOutput.warnings.push("同步游标未推进；已写入记录将在下次运行时按事件键去重。");
    return baseOutput;
  }
}

export function buildSyncWindow(
  now: Date,
  lookbackDays: number,
  lastSuccessfulSync?: string
): PersonalInboxOutput["window"] {
  const end = now.toISOString();
  const last = lastSuccessfulSync ? new Date(lastSuccessfulSync) : null;
  const validLast = last && !Number.isNaN(last.getTime()) ? last : null;
  const startDate = validLast
    ? new Date(validLast.getTime() - 2 * 60 * 60 * 1000)
    : new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  return {
    start: startDate.toISOString(),
    end,
    lookbackDays,
    incremental: Boolean(validLast)
  };
}

export function normalizeMessageActivity(
  value: unknown,
  behavior: InboxBehavior,
  selfOpenId: string,
  now: Date = new Date()
): PersonalInboxActivity | null {
  const message = asRecord(value);
  const messageId = firstString(message, ["message_id", "messageId", "id"]);
  if (!messageId) return null;
  const senderRecord = asRecord(message.sender);
  const senderId = firstString(senderRecord, ["id", "open_id", "openId", "sender_id"])
    || firstString(message, ["sender_id", "senderId"]);
  if (behavior === "收到私聊" && senderId === selfOpenId) return null;
  if (behavior === "被提及" && senderId === selfOpenId) return null;
  if (behavior === "社群发现" && senderId === selfOpenId) return null;
  const sender = firstString(senderRecord, ["name", "display_name", "displayName"])
    || firstString(message, ["sender_name", "senderName"])
    || senderId
    || "未知发送人";
  const chatId = firstString(message, ["chat_id", "chatId"]);
  const chatType = firstString(message, ["chat_type", "chatType"]).toLowerCase();
  const partner = asRecord(message.chat_partner);
  const resolvedSourceName = firstString(message, ["chat_name", "chatName"])
    || firstString(partner, ["name", "display_name"])
    || (chatType === "p2p" && senderId !== selfOpenId ? sender : "")
    || chatId
    || "未知会话";
  const sourceName = chatType === "p2p" && senderId === selfOpenId ? "发给自己" : resolvedSourceName;
  const sourceType = chatType === "p2p" || behavior === "收到私聊" ? "私聊" : "群聊";
  const msgType = firstString(message, ["msg_type", "msgType"]) || "unknown";
  if (behavior === "发出消息" && isGeneratedMemoryCard(message.content, msgType)) return null;
  const summary = message.deleted === true
    ? "[已撤回消息]"
    : summarizeMessageContent(message.content, msgType);
  const contentTime = formatCellDate(firstDefined(message, ["create_time", "createTime"]), now);
  const activityTime = formatCellDate(firstDefined(message, ["update_time", "updateTime", "create_time", "createTime"]), now);
  const contentUrl = extractPrimaryContentUrl(message);
  const metadata = behaviorMetadata(behavior);
  return {
    eventKey: contentUrl ? eventKeyForContentUrl(contentUrl) : `im:${messageId}`,
    title: truncate(`[${behavior}] ${sender}：${summary}`, 120),
    activityTime,
    contentTime,
    behaviors: [behavior],
    section: metadata.section,
    signalStrength: metadata.signalStrength,
    topic: inferTopic(`${summary} ${sourceName}`),
    sourceType,
    sourceName,
    sender,
    summary,
    sourceId: chatId,
    evidenceId: messageId,
    sourceUrl: contentUrl || firstString(message, ["message_app_link", "url", "message_url", "messageUrl"]),
    status: metadata.signalStrength === "辅助" ? "仅记录" : "待整理"
  };
}

export function normalizeDocumentActivity(
  value: unknown,
  behavior: Extract<InboxBehavior, "打开文档" | "编辑文档" | "评论文档">,
  now: Date = new Date()
): PersonalInboxActivity | null {
  const item = asRecord(value);
  const token = firstString(item, ["token", "obj_token", "file_token", "doc_token", "wiki_token"]);
  if (!token) return null;
  const title = stripHighlights(firstString(item, ["title", "name"]) || "未命名文档");
  const url = firstString(item, ["url", "link"]);
  const docType = firstString(item, ["doc_type", "type"]) || "document";
  const timeKeys = behavior === "打开文档"
    ? ["open_time_iso", "open_time", "my_open_time_iso", "my_open_time"]
    : behavior === "编辑文档"
      ? ["my_edit_time_iso", "my_edit_time", "edit_time_iso", "edit_time"]
      : ["my_comment_time_iso", "my_comment_time", "comment_time_iso", "comment_time"];
  const activityTime = formatCellDate(firstDefined(item, timeKeys), now);
  const rawSummary = stripHighlights(firstString(item, ["summary_highlighted", "summary", "description"]));
  const summary = truncate(rawSummary || `[${docType}] ${title}`, SUMMARY_LIMIT);
  const metadata = behaviorMetadata(behavior);
  return {
    eventKey: `drive:${token}`,
    title: truncate(`[${behavior}] ${title}`, 120),
    activityTime,
    contentTime: activityTime,
    behaviors: [behavior],
    section: metadata.section,
    signalStrength: metadata.signalStrength,
    topic: inferTopic(`${title} ${summary}`),
    sourceType: "文档",
    sourceName: title,
    sender: "我",
    summary,
    sourceId: token,
    evidenceId: token,
    sourceUrl: url,
    status: metadata.signalStrength === "主动" ? "待整理" : "仅记录"
  };
}

export function mergeActivities(activities: PersonalInboxActivity[]): PersonalInboxActivity[] {
  const byKey = new Map<string, PersonalInboxActivity>();
  for (const activity of activities) {
    const existing = byKey.get(activity.eventKey);
    if (!existing) {
      byKey.set(activity.eventKey, { ...activity, behaviors: [...activity.behaviors] });
      continue;
    }
    const behaviors = unique([...existing.behaviors, ...activity.behaviors]) as InboxBehavior[];
    const activityTime = compareCellDate(existing.activityTime, activity.activityTime) >= 0
      ? existing.activityTime
      : activity.activityTime;
    const section: InboxSection = existing.section === "我的足迹" || activity.section === "我的足迹"
      ? "我的足迹"
      : "社群发现";
    const signalStrength = strongerSignal(existing.signalStrength, activity.signalStrength);
    byKey.set(activity.eventKey, {
      ...existing,
      ...activity,
      behaviors,
      section,
      signalStrength,
      topic: activity.topic !== "其他" ? activity.topic : existing.topic,
      activityTime,
      contentTime: existing.contentTime || activity.contentTime,
      sourceName: activity.sourceName || existing.sourceName,
      sourceId: activity.sourceId || existing.sourceId,
      sourceUrl: activity.sourceUrl || existing.sourceUrl,
      summary: activity.summary || existing.summary,
      status: signalStrength === "辅助" ? "仅记录" : "待整理"
    });
  }
  return [...byKey.values()]
    .filter((activity) => !activity.behaviors.every((behavior) => behavior === "打开文档"))
    .sort((left, right) => compareCellDate(right.activityTime, left.activityTime));
}

function collectActivities(
  runner: PersonalInboxCommandRunner,
  selfOpenId: string,
  window: PersonalInboxOutput["window"],
  now: Date,
  communityChatIds: string[],
  communityKeywords: string[]
): CollectionResult {
  const activities: PersonalInboxActivity[] = [];
  const warnings: string[] = [];
  const truncatedSources: string[] = [];

  const sources: Array<{ name: string; run: () => { activities: PersonalInboxActivity[]; truncated: boolean } }> = [
    {
      name: "我发送的消息",
      run: () => collectMessageSearch(runner, ["--sender", selfOpenId], "发出消息", selfOpenId, window, now)
    },
    {
      name: "收到的私聊",
      run: () => collectMessageSearch(runner, ["--chat-type", "p2p"], "收到私聊", selfOpenId, window, now)
    },
    {
      name: "群聊中 @ 我的消息",
      run: () => collectMessageSearch(runner, ["--chat-type", "group", "--is-at-me"], "被提及", selfOpenId, window, now)
    },
    {
      name: "社群中的简报、文档与活动",
      run: () => collectMessageSearch(
        runner,
        ["--chat-type", "group", ...(communityChatIds.length ? ["--chat-id", communityChatIds.join(",")] : [])],
        "社群发现",
        selfOpenId,
        window,
        now,
        (item) => isCommunityCandidate(item, communityKeywords)
      )
    },
    {
      name: "当前收藏",
      run: () => collectFlags(runner, selfOpenId, now)
    },
    {
      name: "打开过的云文档",
      run: () => collectDocuments(runner, "打开文档", "--opened-since", "--opened-until", window, now)
    },
    {
      name: "编辑过的云文档",
      run: () => collectDocuments(runner, "编辑文档", "--edited-since", "--edited-until", window, now)
    },
    {
      name: "评论过的云文档",
      run: () => collectDocuments(runner, "评论文档", "--commented-since", "--commented-until", window, now)
    }
  ];

  for (const source of sources) {
    try {
      const result = source.run();
      activities.push(...result.activities);
      if (result.truncated) truncatedSources.push(source.name);
    } catch (error) {
      warnings.push(`${source.name}读取失败：${errorMessage(error)}`);
    }
  }
  return { activities: mergeActivities(activities), warnings, truncatedSources };
}

function collectMessageSearch(
  runner: PersonalInboxCommandRunner,
  filters: string[],
  behavior: InboxBehavior,
  selfOpenId: string,
  window: PersonalInboxOutput["window"],
  now: Date,
  predicate?: (item: JsonRecord) => boolean
): { activities: PersonalInboxActivity[]; truncated: boolean } {
  const items: JsonRecord[] = [];
  let pageToken = "";
  let truncated = false;
  for (let segment = 0; segment < MESSAGE_SEGMENT_LIMIT; segment += 1) {
    const args = [
      "im", "+messages-search", "--query", "", ...filters,
      "--start", toShanghaiRfc3339(window.start), "--end", toShanghaiRfc3339(window.end),
      "--page-size", "50", "--page-all", "--page-limit", "40", "--no-reactions",
      "--as", "user", "--format", "json",
      ...(pageToken ? ["--page-token", pageToken] : [])
    ];
    const envelope = runner(args, `read ${behavior} messages segment ${segment + 1}`);
    items.push(...extractArray(envelope, ["messages", "items", "results"]));
    const data = responseData(envelope);
    const hasMore = Boolean(data.has_more ?? envelope.has_more);
    pageToken = String(data.page_token ?? envelope.page_token ?? "");
    if (!hasMore || !pageToken) break;
    if (segment === MESSAGE_SEGMENT_LIMIT - 1) truncated = true;
  }
  return {
    activities: items
      .filter((item) => !predicate || predicate(item))
      .map((item) => normalizeMessageActivity(item, behavior, selfOpenId, now))
      .filter(notNull),
    truncated
  };
}

function collectFlags(
  runner: PersonalInboxCommandRunner,
  selfOpenId: string,
  now: Date
): { activities: PersonalInboxActivity[]; truncated: boolean } {
  const envelope = runner([
    "im", "+flag-list", "--page-all", "--page-limit", "1000", "--as", "user", "--format", "json"
  ], "read current message flags");
  const data = responseData(envelope);
  const flags = arrayOfRecords(data.flag_items);
  const messageList = arrayOfRecords(data.messages);
  const messageById = new Map(messageList.map((item) => [firstString(item, ["message_id", "id"]), item]));
  const activities = flags.flatMap((flag) => {
    const itemId = firstString(flag, ["item_id", "message_id"]);
    if (!itemId) return [];
    const message = asRecord(flag.message);
    const source = Object.keys(message).length ? message : messageById.get(itemId) || { message_id: itemId };
    const normalized = normalizeMessageActivity(source, "收藏消息", selfOpenId, now);
    if (!normalized) return [];
    normalized.activityTime = formatCellDate(firstDefined(flag, ["update_time", "create_time"]), now);
    normalized.status = "待整理";
    normalized.title = truncate(`[收藏消息] ${normalized.sender}：${normalized.summary}`, 120);
    return [normalized];
  });
  return { activities, truncated: Boolean(data.has_more) };
}

function collectDocuments(
  runner: PersonalInboxCommandRunner,
  behavior: Extract<InboxBehavior, "打开文档" | "编辑文档" | "评论文档">,
  sinceFlag: string,
  untilFlag: string,
  window: PersonalInboxOutput["window"],
  now: Date
): { activities: PersonalInboxActivity[]; truncated: boolean } {
  const items: JsonRecord[] = [];
  let pageToken = "";
  let truncated = false;
  for (let page = 0; page < DRIVE_PAGE_LIMIT; page += 1) {
    const envelope = runner([
      "drive", "+search", "--query", "", sinceFlag, window.start, untilFlag, window.end,
      "--page-size", "20", "--as", "user", "--format", "json",
      ...(pageToken ? ["--page-token", pageToken] : [])
    ], `read ${behavior} documents page ${page + 1}`);
    items.push(...extractArray(envelope, ["results", "items"]));
    const data = responseData(envelope);
    const hasMore = Boolean(data.has_more ?? envelope.has_more);
    pageToken = String(data.page_token ?? envelope.page_token ?? "");
    if (!hasMore || !pageToken) break;
    if (page === DRIVE_PAGE_LIMIT - 1) truncated = true;
  }
  return {
    activities: items.map((item) => normalizeDocumentActivity(item, behavior, now)).filter(notNull),
    truncated
  };
}

function readUserIdentity(
  runner: PersonalInboxCommandRunner,
  profile: string | undefined,
  requiredScopes: string[]
): { openId: string; scopes: Set<string> } {
  const envelope = runner(["auth", "status", "--json", "--verify"], "check user identity and scopes");
  const user = asRecord(asRecord(envelope.identities).user);
  if (user.available !== true || envelope.verified !== true) {
    throw new AuthenticationRequiredError(authLoginCommand(profile, requiredScopes));
  }
  const openId = firstString(user, ["openId", "open_id"]);
  if (!openId) throw new Error("当前用户身份缺少 open_id，无法区分自己发送和收到的消息。");
  const scopes = new Set(firstString(user, ["scope"]).split(/\s+/).filter(Boolean));
  return { openId, scopes };
}

function createBase(
  runner: PersonalInboxCommandRunner,
  rootDir: string,
  profile?: string
): PersonalInboxConfig {
  const envelope = runner([
    "base", "+base-create", "--name", BASE_NAME, "--table-name", TABLE_NAME,
    "--time-zone", TIME_ZONE, "--fields", JSON.stringify(FIELD_DEFINITIONS),
    "--as", "user", "--format", "json"
  ], "create personal inbox Base");
  const data = responseData(envelope);
  let baseToken = findDeepString(data, ["base_token", "app_token", "baseToken"], /^(app|bas)/)
    || findDeepMatchingString(data, /^(app|bas)[A-Za-z0-9_-]+$/);
  let tableId = findDeepString(data, ["table_id", "tableId"], /^tbl/)
    || findDeepMatchingString(data, /^tbl[A-Za-z0-9_-]+$/);
  let baseUrl = findDeepString(data, ["url", "base_url", "baseUrl"], /^https?:\/\//) || "";

  // Some lark-cli releases successfully create the Base but return only a
  // success envelope. Resolve the just-created resource before giving up so
  // the first sync can persist its config and avoid creating a duplicate.
  if (!baseToken) {
    const resolved = runner([
      "base", "+title-resolve", "--title", BASE_NAME,
      "--as", "user", "--format", "json"
    ], "resolve newly created personal inbox Base");
    const resolvedData = responseData(resolved);
    baseToken = findDeepString(resolvedData, ["base_token", "app_token", "baseToken"], /^(app|bas)/)
      || findDeepMatchingString(resolvedData, /^(app|bas)[A-Za-z0-9_-]+$/);
    baseUrl ||= findDeepString(resolvedData, ["url", "base_url", "baseUrl"], /^https?:\/\//) || "";
  }

  if (baseToken && !tableId) {
    const tablesEnvelope = runner([
      "base", "+table-list", "--base-token", baseToken,
      "--as", "user", "--format", "json"
    ], "resolve newly created personal inbox table");
    const tables = extractArray(tablesEnvelope, ["tables"]);
    const table = tables.find((candidate) => firstString(candidate, ["name"]) === TABLE_NAME)
      || (tables.length === 1 ? tables[0] : undefined);
    tableId = table ? firstString(table, ["table_id", "id"]) : "";
  }
  if (!baseToken || !tableId) {
    throw new Error("Base 已请求创建，但返回中缺少 base_token 或 table_id，无法继续初始化。");
  }
  const config: PersonalInboxConfig = {
    schemaVersion: CONFIG_VERSION,
    ...(profile ? { profile } : {}),
    baseToken,
    tableId,
    baseUrl,
    initialized: false
  };
  saveConfig(rootDir, config, profile);
  return config;
}

export function ensureBaseInitialized(
  runner: PersonalInboxCommandRunner,
  rootDir: string,
  config: PersonalInboxConfig,
  profile?: string
): PersonalInboxConfig {
  const fieldsEnvelope = runner([
    "base", "+field-list", "--base-token", config.baseToken, "--table-id", config.tableId,
    "--as", "user", "--format", "json"
  ], "verify personal inbox fields");
  const existingFields = extractArray(fieldsEnvelope, ["fields", "items"]);
  const fieldsByName = new Map(existingFields.map((field) => [firstString(field, ["name", "field_name"]), field]));
  const existingFieldNames = new Set(fieldsByName.keys());
  if (!existingFieldNames.has("活动")) {
    throw new Error("个人收件箱主字段“活动”不存在；为避免写入错误，已停止同步。");
  }
  for (const definition of FIELD_DEFINITIONS.slice(1)) {
    const name = String(definition.name || "");
    if (!existingFieldNames.has(name)) {
      runner([
        "base", "+field-create", "--base-token", config.baseToken, "--table-id", config.tableId,
        "--json", JSON.stringify(definition), "--as", "user", "--format", "json"
      ], `create missing personal inbox field ${name}`);
    } else if (definition.type === "select" && fieldsByName.get(name)?.type === "select") {
      const existingField = fieldsByName.get(name) || {};
      const existingOptions = extractArray(existingField, ["options"]);
      const requiredOptions = extractArray(definition, ["options"]);
      const existingOptionNames = new Set(existingOptions.map((option) => firstString(option, ["name"])));
      const missingOptions = requiredOptions.filter((option) => !existingOptionNames.has(firstString(option, ["name"])));
      if (missingOptions.length) {
        runner([
          "base", "+field-update", "--base-token", config.baseToken, "--table-id", config.tableId,
          "--field-id", firstString(existingField, ["id", "field_id"]) || name,
          "--json", JSON.stringify({
            name,
            type: "select",
            multiple: Boolean(definition.multiple),
            options: [...existingOptions, ...missingOptions]
          }),
          "--yes", "--as", "user", "--format", "json"
        ], `add missing options to personal inbox field ${name}`);
      }
    }
  }
  const viewIds = ensureViews(runner, config);
  const keepViewId = viewIds.get("保留重点");
  if (keepViewId) config.keepViewId = keepViewId;
  if (!config.initialized || keepViewId) {
    config.initialized = true;
    saveConfig(rootDir, config, profile);
  }
  return config;
}

function ensureViews(runner: PersonalInboxCommandRunner, config: PersonalInboxConfig): Map<string, string> {
  const viewIds = new Map<string, string>();
  let viewsEnvelope = runner([
    "base", "+view-list", "--base-token", config.baseToken, "--table-id", config.tableId,
    "--as", "user", "--format", "json"
  ], "list personal inbox views");
  let views = extractArray(viewsEnvelope, ["views", "items"]);
  if (!views.some((view) => firstString(view, ["name"]) === "全部记忆") && views.length) {
    const legacyOrFirst = views.find((view) => firstString(view, ["name"]) === "全部活动") || views[0];
    const firstViewId = firstString(legacyOrFirst, ["id", "view_id"]);
    if (firstViewId) {
      runner([
        "base", "+view-rename", "--base-token", config.baseToken, "--table-id", config.tableId,
        "--view-id", firstViewId, "--name", "全部记忆", "--as", "user", "--format", "json"
      ], "rename default personal inbox view");
    }
  }

  viewsEnvelope = runner([
    "base", "+view-list", "--base-token", config.baseToken, "--table-id", config.tableId,
    "--as", "user", "--format", "json"
  ], "refresh personal inbox views");
  views = extractArray(viewsEnvelope, ["views", "items"]);
  for (const definition of VIEW_DEFINITIONS) {
    let view = views.find((item) => firstString(item, ["name"]) === definition.name);
    if (!view) {
      const created = runner([
        "base", "+view-create", "--base-token", config.baseToken, "--table-id", config.tableId,
        "--json", JSON.stringify({ name: definition.name, type: "grid" }), "--as", "user", "--format", "json"
      ], `create personal inbox view ${definition.name}`);
      const createdViews = extractArray(created, ["views", "items"]);
      const createdViewId = findDeepString(responseData(created), ["view_id", "id"], /^vew/)
        || findDeepMatchingString(responseData(created), /^vew[A-Za-z0-9_-]+$/);
      view = createdViews[0] || (createdViewId ? { id: createdViewId, name: definition.name } : responseData(created));
      views.push(view);
    }
    const viewId = firstString(view, ["id", "view_id"]);
    if (!viewId) throw new Error(`视图“${definition.name}”创建后缺少 view_id。`);
    viewIds.set(definition.name, viewId);
    configureView(runner, config, viewId, definition.filter, definition.sortField);
  }
  return viewIds;
}

function configureView(
  runner: PersonalInboxCommandRunner,
  config: PersonalInboxConfig,
  viewId: string,
  filter: JsonRecord,
  sortField: string
): void {
  runner([
    "base", "+view-get-filter", "--base-token", config.baseToken, "--table-id", config.tableId,
    "--view-id", viewId, "--as", "user", "--format", "json"
  ], `read current filter for view ${viewId}`);
  runner([
    "base", "+view-set-filter", "--base-token", config.baseToken, "--table-id", config.tableId,
    "--view-id", viewId, "--json", JSON.stringify(filter), "--as", "user", "--format", "json"
  ], `set filter for view ${viewId}`);
  runner([
    "base", "+view-get-sort", "--base-token", config.baseToken, "--table-id", config.tableId,
    "--view-id", viewId, "--as", "user", "--format", "json"
  ], `read current sort for view ${viewId}`);
  runner([
    "base", "+view-set-sort", "--base-token", config.baseToken, "--table-id", config.tableId,
    "--view-id", viewId, "--json", JSON.stringify({ sort_config: [{ field: sortField, desc: true }] }),
    "--as", "user", "--format", "json"
  ], `set sort for view ${viewId}`);
  const visibleEnvelope = runner([
    "base", "+view-get-visible-fields", "--base-token", config.baseToken, "--table-id", config.tableId,
    "--view-id", viewId, "--as", "user", "--format", "json"
  ], `read visible fields for view ${viewId}`);
  const currentVisible = arrayOfStrings(responseData(visibleEnvelope).visible_fields);
  const sameVisibleFields = currentVisible.length === VISIBLE_FIELDS.length
    && VISIBLE_FIELDS.every((field) => currentVisible.includes(field));
  if (!sameVisibleFields) {
    runner([
      "base", "+view-set-visible-fields", "--base-token", config.baseToken, "--table-id", config.tableId,
      "--view-id", viewId, "--json", JSON.stringify({ visible_fields: VISIBLE_FIELDS }),
      "--as", "user", "--format", "json"
    ], `set visible fields for view ${viewId}`);
  }
}

export function listExistingRecords(
  runner: PersonalInboxCommandRunner,
  config: PersonalInboxConfig
): Map<string, PersonalMemoryRecord> {
  const existing = new Map<string, PersonalMemoryRecord>();
  for (let page = 0; page < BASE_PAGE_LIMIT; page += 1) {
    const offset = page * 200;
    const envelope = runner([
      "base", "+record-list", "--base-token", config.baseToken, "--table-id", config.tableId,
      "--field-id", "事件键", "--field-id", "行为", "--field-id", "活动时间", "--field-id", "内容时间",
      "--field-id", "收件区", "--field-id", "信号强度", "--field-id", "主题",
      "--field-id", "活动", "--field-id", "内容摘要", "--field-id", "来源类型", "--field-id", "来源名称",
       "--field-id", "发送人", "--field-id", "来源ID", "--field-id", "证据ID", "--field-id", "来源链接",
      "--field-id", "是否重点", "--field-id", "保留时间",
      "--offset", String(offset), "--limit", "200",
      "--as", "user", "--format", "json"
    ], `read existing personal inbox records page ${page + 1}`);
    const data = responseData(envelope);
    const fields = arrayOfStrings(data.fields);
    const rows = Array.isArray(data.data) ? data.data : [];
    const recordIds = arrayOfStrings(data.record_id_list);
    for (let index = 0; index < rows.length; index += 1) {
      if (!Array.isArray(rows[index])) continue;
      const row = Object.fromEntries(fields.map((field, fieldIndex) => [field, (rows[index] as unknown[])[fieldIndex] ?? null]));
      const eventKey = textOf(row["事件键"]);
      const recordId = recordIds[index] || firstString(asRecord(row), ["record_id"]);
      if (!eventKey || !recordId) continue;
      existing.set(eventKey, {
        recordId,
        eventKey,
        behaviors: normalizeSelectCell(row["行为"]),
        section: textOf(row["收件区"]),
        signalStrength: textOf(row["信号强度"]),
        topic: textOf(row["主题"]),
        activityTime: textOf(row["活动时间"]),
        contentTime: textOf(row["内容时间"]),
        title: textOf(row["活动"]),
        summary: textOf(row["内容摘要"]),
        sourceType: textOf(row["来源类型"]),
        sourceName: textOf(row["来源名称"]),
        sender: textOf(row["发送人"]),
        sourceId: textOf(row["来源ID"]),
        evidenceId: textOf(row["证据ID"]),
        sourceUrl: textOf(row["来源链接"]),
        kept: checkboxValue(row["是否重点"]),
        keptAt: textOf(row["保留时间"])
      });
    }
    const hasMore = Boolean(data.has_more);
    if (!hasMore || rows.length < 200) return existing;
  }
  throw new Error("个人收件箱记录超过 100000 条，读取去重索引达到安全上限。");
}

function diffActivities(
  activities: PersonalInboxActivity[],
  existing: Map<string, PersonalMemoryRecord>
): {
  creates: PersonalInboxActivity[];
  updates: Array<{ recordId: string; activity: PersonalInboxActivity }>;
  counts: { new: number; updated: number; skipped: number };
} {
  const creates: PersonalInboxActivity[] = [];
  const updates: Array<{ recordId: string; activity: PersonalInboxActivity }> = [];
  let skipped = 0;
  for (const activity of activities) {
    const current = existing.get(activity.eventKey);
    if (!current) {
      creates.push(activity);
      continue;
    }
    const mergedBehaviors = unique([...current.behaviors, ...activity.behaviors]);
    const changed = [...mergedBehaviors].sort().join("|") !== [...unique(current.behaviors)].sort().join("|")
      || current.section !== activity.section
      || current.signalStrength !== activity.signalStrength
      || current.topic !== activity.topic
      || current.activityTime !== activity.activityTime
      || current.contentTime !== activity.contentTime
      || current.title !== activity.title
      || current.summary !== activity.summary
      || current.sourceType !== activity.sourceType
      || current.sourceName !== activity.sourceName
      || current.sender !== activity.sender
      || current.sourceId !== activity.sourceId
      || current.evidenceId !== activity.evidenceId
      || current.sourceUrl !== activity.sourceUrl;
    if (changed) {
      updates.push({ recordId: current.recordId, activity: { ...activity, behaviors: mergedBehaviors as InboxBehavior[] } });
    } else {
      skipped += 1;
    }
  }
  return { creates, updates, counts: { new: creates.length, updated: updates.length, skipped } };
}

function writeNewActivities(
  runner: PersonalInboxCommandRunner,
  config: PersonalInboxConfig,
  activities: PersonalInboxActivity[],
  now: Date
): void {
  for (let offset = 0; offset < activities.length; offset += 200) {
    const batch = activities.slice(offset, offset + 200);
    const body = {
      fields: WRITABLE_FIELDS,
      rows: batch.map((activity) => activityCells(activity, now, true))
    };
    runWithRetry(runner, [
      "base", "+record-batch-create", "--base-token", config.baseToken, "--table-id", config.tableId,
      "--json", JSON.stringify(body), "--as", "user", "--format", "json"
    ], `create personal inbox records batch ${Math.floor(offset / 200) + 1}`);
  }
}

function writeUpdatedActivities(
  runner: PersonalInboxCommandRunner,
  config: PersonalInboxConfig,
  updates: Array<{ recordId: string; activity: PersonalInboxActivity }>,
  now: Date
): void {
  for (const update of updates) {
    const cells = activityCells(update.activity, now, false);
    const patch = Object.fromEntries(SYSTEM_UPDATE_FIELDS.map((field, index) => [field, cells[index]]));
    runWithRetry(runner, [
      "base", "+record-upsert", "--base-token", config.baseToken, "--table-id", config.tableId,
      "--record-id", update.recordId, "--json", JSON.stringify(patch), "--as", "user", "--format", "json"
    ], `update personal inbox record ${update.recordId}`);
  }
}

function activityCells(activity: PersonalInboxActivity, now: Date, includeStatus: boolean): unknown[] {
  const all = [
    activity.title,
    activity.activityTime,
    activity.contentTime,
    activity.behaviors,
    activity.section,
    activity.signalStrength,
    activity.topic,
    activity.sourceType,
    activity.sourceName,
    activity.sender,
    activity.summary,
    activity.sourceId,
    activity.evidenceId,
    activity.sourceUrl || null,
    activity.status,
    activity.eventKey,
    formatCellDate(now, now)
  ];
  return includeStatus ? all : all.filter((_value, index) => WRITABLE_FIELDS[index] !== "处理状态");
}

function runWithRetry(
  runner: PersonalInboxCommandRunner,
  args: string[],
  label: string
): JsonRecord {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return runner(args, label);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === 2) throw error;
      const until = Date.now() + (attempt + 1) * 250;
      while (Date.now() < until) {
        // Short bounded backoff keeps writes serial without introducing a long blocking wait.
      }
    }
  }
  throw lastError;
}

function isRetryable(error: unknown): boolean {
  const failure = error as CommandFailure;
  const envelope = asRecord(failure.envelope);
  const apiError = asRecord(envelope.error);
  const code = String(apiError.code || "");
  const message = `${failure.message || ""} ${String(apiError.message || "")}`;
  return code === "1254291" || /rate.?limit|too many requests|concurrent/i.test(message);
}

function failureOutput(
  output: PersonalInboxOutput,
  status: "error",
  error: unknown
): PersonalInboxOutput {
  output.status = status;
  output.warnings.push(errorMessage(error));
  return output;
}

export function loadPersonalInboxConfig(rootDir: string, profile?: string): PersonalInboxConfig | null {
  const path = configPath(rootDir, profile);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as PersonalInboxConfig;
  if (parsed.schemaVersion !== CONFIG_VERSION || !parsed.baseToken || !parsed.tableId) {
    throw new Error(`Unsupported or invalid personal inbox config: ${path}`);
  }
  if (profile && parsed.profile !== profile) {
    throw new Error(`Personal inbox config profile mismatch: expected ${profile}, found ${parsed.profile || "none"}.`);
  }
  return parsed;
}

const loadConfig = loadPersonalInboxConfig;

function saveConfig(rootDir: string, config: PersonalInboxConfig, profile?: string): void {
  const directory = join(rootDir, ".larkwing");
  mkdirSync(directory, { recursive: true });
  const path = configPath(rootDir, profile);
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

function configPath(rootDir: string, profile?: string): string {
  const filename = profile ? `personal-inbox.${profile}.json` : CONFIG_FILENAME;
  return join(rootDir, ".larkwing", filename);
}

export function buildKeepViewUrl(config: PersonalInboxConfig): string {
  if (!config.keepViewId) return config.baseUrl;
  const separator = config.baseUrl.includes("?") ? "&" : "?";
  return `${config.baseUrl}${separator}table=${encodeURIComponent(config.tableId)}&view=${encodeURIComponent(config.keepViewId)}`;
}

export function savePersonalInboxCommunityChats(
  rootDir: string,
  profile: string,
  chats: Array<{ chatId: string; name: string }>
): PersonalInboxConfig {
  if (!chats.length) throw new Error("请至少保留 1 个关注社群。");
  const normalized = unique(chats.map((chat) => chat.chatId)).map((chatId) => {
    if (!/^oc_[A-Za-z0-9_-]+$/.test(chatId)) throw new Error(`Invalid community chat ID: ${chatId}`);
    const chat = chats.find((item) => item.chatId === chatId);
    return { chatId, name: truncate(chat?.name.trim() || chatId, 120) };
  });
  const config = loadPersonalInboxConfig(rootDir, profile);
  if (!config) throw new Error(`未找到 ${profile} 的个人信息记忆配置。`);
  config.communityChatIds = normalized.map((chat) => chat.chatId);
  config.communityChats = normalized;
  saveConfig(rootDir, config, profile);
  return config;
}

export function markPersonalMemoryHighlights(
  runner: PersonalInboxCommandRunner,
  config: PersonalInboxConfig,
  recordIds: string[],
  keptAt = new Date()
): void {
  const timestamp = formatCellDate(keptAt, keptAt);
  const safeRecordIds = unique(recordIds).slice(0, 9);
  for (const recordId of safeRecordIds) {
    if (!/^rec[A-Za-z0-9_-]+$/.test(recordId)) throw new Error(`Invalid personal memory record ID: ${recordId}`);
  }
  if (!safeRecordIds.length) return;
  runWithRetry(runner, [
    "base", "+record-batch-update", "--base-token", config.baseToken, "--table-id", config.tableId,
    "--json", JSON.stringify({
      record_id_list: safeRecordIds,
      patch: { "是否重点": true, "保留时间": timestamp }
    }),
    "--as", "user", "--format", "json"
  ], "keep personal memory records");
}

function normalizeProfileName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const profile = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile) || profile === "." || profile === "..") {
    throw new Error("Invalid lark-cli profile name.");
  }
  return profile;
}

function authLoginCommand(profile: string | undefined, scopes: string[]): string {
  return `larkwing auth login${profile ? ` --profile ${profile}` : ""} --scope "${scopes.join(" ")}"`;
}

function normalizeLookbackDays(value: string | undefined): number {
  const parsed = Number(value || 7);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 90) {
    throw new Error("lookback_days 必须是 1 到 90 之间的整数。");
  }
  return parsed;
}

function normalizeBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "是"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "否"].includes(normalized)) return false;
  throw new Error("deliver_review 必须是 true 或 false。");
}

function parseCsv(value: string | undefined): string[] {
  return unique((value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

function countByBehavior(activities: PersonalInboxActivity[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const activity of activities) {
    for (const behavior of activity.behaviors) counts[behavior] = (counts[behavior] || 0) + 1;
  }
  return counts;
}

function countBySection(activities: PersonalInboxActivity[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const activity of activities) counts[activity.section] = (counts[activity.section] || 0) + 1;
  return counts;
}

function behaviorMetadata(behavior: InboxBehavior): {
  section: InboxSection;
  signalStrength: InboxSignalStrength;
} {
  if (behavior === "社群发现") return { section: "社群发现", signalStrength: "候选" };
  if (["收藏消息", "编辑文档", "评论文档"].includes(behavior)) {
    return { section: "我的足迹", signalStrength: "主动" };
  }
  if (["收到私聊", "被提及"].includes(behavior)) {
    return { section: "我的足迹", signalStrength: "直接相关" };
  }
  return { section: "我的足迹", signalStrength: "辅助" };
}

function strongerSignal(left: InboxSignalStrength, right: InboxSignalStrength): InboxSignalStrength {
  const rank: Record<InboxSignalStrength, number> = { 主动: 4, 直接相关: 3, 候选: 2, 辅助: 1 };
  return rank[left] >= rank[right] ? left : right;
}

function inferTopic(value: string): string {
  const text = value.toLowerCase();
  if (/\bai\b|agi|agent|智能体|模型|大模型|llm|算法|编程|代码|开发/.test(text)) return "AI 与技术";
  if (/知识|学习|笔记|阅读|研究|课程|教程|方法论/.test(text)) return "知识与学习";
  if (/产品|设计|用户|体验|需求|原型|交互|品牌/.test(text)) return "产品与设计";
  if (/分享会|直播|会议|活动|报名|日程|讲座|沙龙|发布会/.test(text)) return "社群活动";
  if (/项目|进度|任务|协作|周报|复盘|计划|okr/.test(text)) return "项目与协作";
  return "其他";
}

function extractPrimaryContentUrl(message: JsonRecord): string {
  const direct = firstString(message, ["content_url", "contentUrl"]);
  if (direct) return direct;
  let content: unknown = message.content;
  if (typeof content === "string" && /^[\[{]/.test(content.trim())) {
    try {
      content = JSON.parse(content);
    } catch {
      // A plain-text message can still contain a useful URL.
    }
  }
  return findFirstUrl(content);
}

function findFirstUrl(value: unknown): string {
  if (typeof value === "string") {
    const match = value.match(/https?:\/\/[^\s<>"')\]}]+/i);
    return match ? match[0] : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstUrl(item);
      if (found) return found;
    }
    return "";
  }
  if (value && typeof value === "object") {
    const record = value as JsonRecord;
    for (const key of ["href", "url", "link"]) {
      const found = findFirstUrl(record[key]);
      if (found) return found;
    }
    for (const item of Object.values(record)) {
      const found = findFirstUrl(item);
      if (found) return found;
    }
  }
  return "";
}

function canonicalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(from|source|utm_|share|track)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/[?#].*$/, "").replace(/\/$/, "");
  }
}

function eventKeyForContentUrl(value: string): string {
  const canonical = canonicalizeUrl(value);
  const match = canonical.match(/\/(?:docx|docs|wiki)\/([A-Za-z0-9_-]+)/i);
  return match ? `drive:${match[1]}` : `content:${canonical}`;
}

function isCommunityCandidate(message: JsonRecord, customKeywords: string[]): boolean {
  if (message.deleted === true) return false;
  const msgType = firstString(message, ["msg_type", "msgType"]).toLowerCase();
  const rawContent = textOf(message.content);
  if (msgType === "video_chat" || /^\[video call\]$/i.test(rawContent.trim())) return false;
  if (["file", "share_chat", "calendar", "event", "share_calendar_event"].includes(msgType)) return true;
  if (extractPrimaryContentUrl(message)) return true;
  const summary = summarizeMessageContent(message.content, msgType);
  const builtIn = /简报|分享会|直播|会议|活动|报名|日程|讲座|沙龙|发布会|报告|白皮书|课程|公开课|资料|合集/i;
  return builtIn.test(summary) || customKeywords.some((keyword) => summary.toLowerCase().includes(keyword.toLowerCase()));
}

export function buildWeeklyMemoryReview(
  activities: PersonalInboxActivity[],
  window: PersonalInboxOutput["window"],
  requested = false,
  links: { detailPageUrl?: string; memoryHomeUrl?: string; communitySettingsUrl?: string } = {}
): WeeklyMemoryReview {
  const reviewable = activities.filter(isReviewableActivity);
  const sorted = [...reviewable].sort((left, right) => {
    const signal = strongerSignal(left.signalStrength, right.signalStrength);
    if (left.signalStrength !== right.signalStrength) return signal === left.signalStrength ? -1 : 1;
    return compareCellDate(right.activityTime, left.activityTime);
  });
  const personal = sorted.filter((activity) => activity.section === "我的足迹");
  const community = sorted.filter((activity) => activity.section === "社群发现");
  const communitySourceCount = new Set(community.map((activity) => activity.sourceId).filter(Boolean)).size;
  const byTopic = new Map<string, PersonalInboxActivity[]>();
  for (const activity of sorted) {
    const group = byTopic.get(activity.topic) || [];
    group.push(activity);
    byTopic.set(activity.topic, group);
  }
  const themes = [...byTopic.entries()]
    .sort((left, right) => {
      if (left[0] === "其他" && right[0] !== "其他") return 1;
      if (right[0] === "其他" && left[0] !== "其他") return -1;
      return right[1].length - left[1].length || left[0].localeCompare(right[0], "zh-CN");
    })
    .slice(0, 5)
    .map(([name, items]) => ({
      name,
      count: items.length,
      personalCount: items.filter((item) => item.section === "我的足迹").length,
      communityCount: items.filter((item) => item.section === "社群发现").length,
      highlights: items.slice(0, 3).map(toWeeklyHighlight)
    }));
  const personalHighlights = personal.slice(0, 4).map(toWeeklyHighlight);
  const communityDiscoveries = community.slice(0, 5).map(toWeeklyHighlight);
  const title = `本周信息足迹｜${formatReviewDate(window.start)}—${formatReviewDate(window.end)}`;
  const summary = `本周形成 ${reviewable.length} 条有效记忆：个人足迹 ${personal.length} 条，社群发现 ${community.length} 条，集中在 ${themes.length} 个主题。`;
  const markdown = renderWeeklyReviewMarkdown(title, summary, themes, personalHighlights, communityDiscoveries);
  const review: WeeklyMemoryReview = {
    reviewKey: `weekly:${window.start.slice(0, 10)}:${window.end.slice(0, 10)}`,
    title,
    summary,
    personalCount: personal.length,
    communityCount: community.length,
    communitySourceCount,
    themes,
    personalHighlights,
    communityDiscoveries,
    markdown,
    card: {},
    detailPage: { requested, created: false },
    delivery: { requested, sent: false, format: "interactive_card" }
  };
  review.card = buildWeeklyMemoryCard(review, links);
  return review;
}

export function buildWeeklyMemoryCard(
  review: WeeklyMemoryReview,
  links: {
    detailPageUrl?: string;
    memoryHomeUrl?: string;
    communitySettingsUrl?: string;
    ownerOpenId?: string;
    keepViewUrl?: string;
  } = {}
): JsonRecord {
  const themeLines = review.themes.length
    ? review.themes.slice(0, 5).map((theme, index) => `${index + 1}. **${cardText(theme.name)}**`).join("\n")
    : "本周还没有形成可回顾的主题。";
  const personalLines = compactCardHighlights(review.personalHighlights, "本周暂无主动足迹");
  const communityLines = compactCardHighlights(review.communityDiscoveries, "本周暂无社群发现");
  const connectedTheme = review.themes.find((theme) => theme.name !== "其他" && theme.personalCount > 0 && theme.communityCount > 0)
    || review.themes.find((theme) => theme.personalCount > 0 && theme.communityCount > 0);
  const connection = connectedTheme
    ? `你主动关注的内容与社群发现，都指向 **${cardText(connectedTheme.name)}**。`
    : "本周暂未发现明确的跨来源主题连接。";
  const actionColumns: JsonRecord[] = [
    cardButtonColumn("查看完整回顾", "primary_filled", links.detailPageUrl
      ? { type: "open_url", default_url: links.detailPageUrl }
      : { type: "callback", value: { action: "open_weekly_review" } })
  ];
  const candidates = [...review.personalHighlights.slice(0, 4), ...review.communityDiscoveries.slice(0, 5)];
  const candidateRecordIds = unique(candidates.map((item) => item.recordId || "").filter(Boolean));
  const keepAvailable = Boolean(links.ownerOpenId && candidates.length && candidateRecordIds.length === candidates.length);
  actionColumns.push(cardButtonColumn(
    "保留重点",
    "default",
    keepAvailable ? {
      type: "callback",
      value: {
        action: "keep_weekly_highlights",
        version: 1,
        owner_open_id: links.ownerOpenId,
        review_key: review.reviewKey,
        record_ids: candidateRecordIds,
        detail_page_url: links.detailPageUrl || "",
        keep_view_url: links.keepViewUrl || ""
      }
    } : undefined,
    keepAvailable ? undefined : "同步后可用"
  ));
  actionColumns.push(cardButtonColumn(
    "调整关注社群",
    "default",
    links.communitySettingsUrl
      ? { type: "open_url", default_url: links.communitySettingsUrl }
      : links.ownerOpenId ? {
        type: "callback",
        value: {
          action: "adjust_community_chats",
          version: 1,
          owner_open_id: links.ownerOpenId,
          review_key: review.reviewKey
        }
      } : undefined,
    links.ownerOpenId || links.communitySettingsUrl ? undefined : "发送后可用"
  ));

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "default",
      enable_forward: false,
      summary: { content: review.title },
      style: {
        color: {
          "memory-blue": { light_mode: "rgba(30,120,255,1)", dark_mode: "rgba(80,150,255,1)" },
          "memory-muted": { light_mode: "rgba(100,106,115,1)", dark_mode: "rgba(150,155,163,1)" }
        }
      }
    },
    ...(links.memoryHomeUrl ? { card_link: { url: links.memoryHomeUrl } } : {}),
    header: {
      title: { tag: "plain_text", content: review.title },
      subtitle: { tag: "plain_text", content: "自动整理 · 约 5 分钟读完" },
      template: "blue",
      icon: { tag: "standard_icon", token: "myai_colorful" },
      text_tag_list: [{
        tag: "text_tag",
        text: { tag: "plain_text", content: `${review.themes.length} 个主题` },
        color: "blue"
      }]
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 20px 12px",
      vertical_spacing: "large",
      elements: [
        {
          tag: "column_set",
          flex_mode: "none",
          background_style: "blue-50",
          columns: [{
            tag: "column",
            width: "weighted",
            weight: 1,
            padding: "12px",
            vertical_spacing: "4px",
            elements: [
              { tag: "markdown", content: "**你本周主要关注**", text_size: "heading-3", element_id: "focus" },
              { tag: "markdown", content: themeLines, element_id: "themes" }
            ]
          }]
        },
        {
          tag: "column_set",
          flex_mode: "bisect",
          horizontal_spacing: "medium",
          columns: [
            metricColumn(String(review.personalCount), "我的足迹"),
            metricColumn(String(review.communityCount), `社群发现 · ${review.communitySourceCount} 个来源`)
          ]
        },
        {
          tag: "column_set",
          flex_mode: "bisect",
          horizontal_spacing: "medium",
          columns: [
            contentColumn("我的足迹", personalLines, "blue-50", "blue"),
            contentColumn("社群发现", communityLines, "violet-50", "violet")
          ]
        },
        {
          tag: "column_set",
          flex_mode: "none",
          background_style: "grey-50",
          columns: [{
            tag: "column",
            width: "weighted",
            weight: 1,
            padding: "12px",
            elements: [{ tag: "markdown", content: `**本周连接**\n${connection}`, element_id: "connection" }]
          }]
        },
        {
          tag: "column_set",
          flex_mode: "none",
          horizontal_spacing: "small",
          columns: actionColumns
        }
      ]
    }
  };
}

function compactCardHighlights(items: WeeklyMemoryHighlight[], empty: string): string {
  if (!items.length) return empty;
  return items.slice(0, 2).map((item) => `• ${cardText(truncate(item.title, 42))}`).join("\n");
}

function metricColumn(value: string, label: string): JsonRecord {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    background_style: "grey-50",
    padding: "12px",
    vertical_spacing: "2px",
    elements: [
      { tag: "markdown", content: `**<font color='blue'>${value}</font>**`, text_align: "center" },
      { tag: "markdown", content: `<font color='grey'>${label}</font>`, text_align: "center", text_size: "notation" }
    ]
  };
}

function contentColumn(title: string, content: string, background: string, color: string): JsonRecord {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    padding: "12px",
    background_style: background,
    vertical_spacing: "4px",
    elements: [{ tag: "markdown", content: `**<font color='${color}'>${title}</font>**\n${content}` }]
  };
}

function cardButtonColumn(text: string, type: string, behavior?: JsonRecord, disabledTip?: string): JsonRecord {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    elements: [{
      tag: "button",
      text: { tag: "plain_text", content: text },
      type,
      width: "fill",
      ...(behavior ? { behaviors: [behavior] } : { disabled: true }),
        ...(disabledTip
          ? { disabled_tips: { tag: "plain_text", content: disabledTip } }
          : {})
    }]
  };
}

function cardText(value: string): string {
  return value
    .replace(/&/g, "＆")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(/([\\`*_{}\[\]()#+\-.!|~])/g, "\\$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isReviewableActivity(activity: PersonalInboxActivity): boolean {
  const summary = activity.summary.trim();
  if (!summary) return false;
  if (activity.section === "我的足迹" && !activity.behaviors.some((behavior) =>
    ["发出消息", "收藏消息", "编辑文档", "评论文档"].includes(behavior))) return false;
  if (/^\[(?:video call|[^\]]*消息|互动卡片|系统消息|已撤回消息)\]$/i.test(summary)) return false;
  if (/^\d+\s*(?:min|分钟)$/i.test(summary)) return false;
  return Boolean(activity.sourceUrl) || summary.length >= 6;
}

function toWeeklyHighlight(activity: PersonalInboxActivity): WeeklyMemoryHighlight {
  return {
    eventKey: activity.eventKey,
    title: truncate(activity.summary || activity.title, 100),
    sourceName: activity.sourceName,
    sourceUrl: activity.sourceUrl,
    section: activity.section
  };
}

export function bindWeeklyReviewRecords(
  review: WeeklyMemoryReview,
  records: Map<string, PersonalMemoryRecord>
): WeeklyMemoryReview {
  const bind = (item: WeeklyMemoryHighlight): WeeklyMemoryHighlight => {
    const record = records.get(item.eventKey);
    if (!record) return item;
    return { ...item, recordId: record.recordId, kept: record.kept, keptAt: record.keptAt };
  };
  review.personalHighlights = review.personalHighlights.map(bind);
  review.communityDiscoveries = review.communityDiscoveries.map(bind);
  review.themes = review.themes.map((theme) => ({ ...theme, highlights: theme.highlights.map(bind) }));
  return review;
}

function renderWeeklyReviewMarkdown(
  title: string,
  summary: string,
  themes: WeeklyMemoryTheme[],
  personal: WeeklyMemoryHighlight[],
  community: WeeklyMemoryHighlight[]
): string {
  const lines = [`# ${title}`, "", summary, "", "## 本周主题"];
  if (!themes.length) lines.push("", "本周还没有形成可回顾的有效记忆。");
  for (const theme of themes) {
    lines.push("", `- **${markdownText(theme.name)}**：${theme.count} 条（我的足迹 ${theme.personalCount}，社群发现 ${theme.communityCount}）`);
  }
  lines.push("", "## 我的足迹");
  lines.push(...renderHighlightLines(personal, "本周暂无主动或直接相关足迹。"));
  lines.push("", "## 社群发现");
  lines.push(...renderHighlightLines(community, "本周暂无符合条件的社群内容。"));
  return lines.join("\n");
}

function renderHighlightLines(items: WeeklyMemoryHighlight[], empty: string): string[] {
  if (!items.length) return ["", empty];
  return items.map((item) => {
    const title = markdownText(item.title);
    const source = markdownText(item.sourceName);
    return item.sourceUrl
      ? `- [${title}](${item.sourceUrl}) · ${source}`
      : `- ${title} · ${source}`;
  });
}

function markdownText(value: string): string {
  return value.replace(/[\[\]*_`]/g, "\\$&").replace(/\s+/g, " ").trim();
}

function formatReviewDate(value: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: TIME_ZONE,
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.month} 月 ${map.day} 日`;
}

function createWeeklyReviewPage(
  runner: PersonalInboxCommandRunner,
  review: WeeklyMemoryReview,
  parentToken: string
): { url: string; documentId?: string } {
  const envelope = runner([
    "docs", "+create", "--content", renderWeeklyReviewXml(review),
    ...(parentToken ? ["--parent-token", parentToken] : ["--parent-position", "my_library"]),
    "--as", "user", "--format", "json"
  ], "create weekly memory review page");
  const data = responseData(envelope);
  const url = findDeepString(data, ["url"], /^https?:\/\//);
  const documentId = findDeepString(data, ["document_id", "documentId", "token"]);
  if (!url) throw new Error("完整回顾页已请求创建，但返回中缺少文档链接。");
  return { url, ...(documentId ? { documentId } : {}) };
}

export function renderWeeklyReviewXml(review: WeeklyMemoryReview): string {
  const chunks = [
    `<title>${xmlText(review.title)}</title>`,
    `<callout emoji="🧠" background-color="light-blue" border-color="blue"><p>${xmlText(review.summary)}</p></callout>`,
    "<h1>本周主题回顾</h1>"
  ];
  if (!review.themes.length) {
    chunks.push("<p>本周还没有形成可回顾的有效记忆。</p>");
  }
  for (const theme of review.themes) {
    chunks.push(`<h2>${xmlText(theme.name)}</h2>`);
    chunks.push(`<p>本周有 ${theme.count} 条相关内容：我的足迹 ${theme.personalCount} 条，社群发现 ${theme.communityCount} 条。这些主动行为与社群信号共同构成了本主题的判断依据。</p>`);
    if (theme.highlights.length) {
      chunks.push("<ul>");
      for (const item of theme.highlights) {
        chunks.push(`<li><b>${xmlText(item.section)}</b> · ${xmlText(item.title)}${item.sourceName ? ` · ${xmlText(item.sourceName)}` : ""}</li>`);
      }
      chunks.push("</ul>");
      for (const item of theme.highlights.filter((highlight) => /^https?:\/\//.test(highlight.sourceUrl))) {
        chunks.push(`<bookmark name="${xmlAttribute(truncate(item.title, 80))}" href="${xmlAttribute(item.sourceUrl)}"></bookmark>`);
      }
    }
  }
  appendReviewHighlightsXml(chunks, "我的足迹", review.personalHighlights, "本周暂无主动足迹。");
  appendReviewHighlightsXml(chunks, "社群发现", review.communityDiscoveries, "本周暂无符合条件的社群内容。");
  const connectedTheme = review.themes.find((theme) => theme.name !== "其他" && theme.personalCount > 0 && theme.communityCount > 0)
    || review.themes.find((theme) => theme.personalCount > 0 && theme.communityCount > 0);
  chunks.push("<h1>本周连接</h1>");
  chunks.push(`<p>${connectedTheme
    ? `你主动关注的内容与社群发现都指向“${xmlText(connectedTheme.name)}”。这可能是值得继续探索的方向。`
    : "本周暂未发现明确的跨来源主题连接。"}</p>`);
  chunks.push("<h1>回顾说明</h1>");
  chunks.push("<p>本页按主题组织，不按群聊、文档或收藏来源分类。单纯打开文档等弱行为只作为辅助证据，不要求逐条处理。</p>");
  return chunks.join("");
}

function appendReviewHighlightsXml(
  chunks: string[],
  heading: string,
  highlights: WeeklyMemoryHighlight[],
  empty: string
): void {
  chunks.push(`<h1>${xmlText(heading)}</h1>`);
  if (!highlights.length) {
    chunks.push(`<p>${xmlText(empty)}</p>`);
    return;
  }
  chunks.push("<ul>");
  for (const item of highlights) {
    const title = /^https?:\/\//.test(item.sourceUrl)
      ? `<a href="${xmlAttribute(item.sourceUrl)}">${xmlText(item.title)}</a>`
      : xmlText(item.title);
    chunks.push(`<li>${title}${item.sourceName ? ` · ${xmlText(item.sourceName)}` : ""}</li>`);
  }
  chunks.push("</ul>");
}

function xmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>");
}

function xmlAttribute(value: string): string {
  return xmlText(value).replace(/"/g, "&quot;");
}

function deliverWeeklyReviewCard(
  runner: PersonalInboxCommandRunner,
  selfOpenId: string,
  review: WeeklyMemoryReview,
  window: PersonalInboxOutput["window"],
  rootDir: string,
  profile?: string
): string {
  const idempotencyKey = `personal-memory-v3-${window.end.slice(0, 10)}-${profile || "default"}`;
  const envelope = runner([
    "im", "+messages-send", "--user-id", selfOpenId, "--msg-type", "interactive",
    "--content", JSON.stringify(review.card),
    "--idempotency-key", idempotencyKey, "--as", "user", "--format", "json"
  ], "send weekly memory card to self");
  const messageId = findDeepString(responseData(envelope), ["message_id", "messageId", "id"]);
  if (messageId) saveDeliveredCardSnapshot(rootDir, profile, messageId, review.card);
  return messageId;
}

function saveDeliveredCardSnapshot(rootDir: string, profile: string | undefined, messageId: string, card: JsonRecord): void {
  const safeProfile = profile || "default";
  const directory = join(rootDir, ".larkwing", "personal-memory-callbacks", safeProfile, "cards");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${messageId}.json`);
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(card, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

function summarizeMessageContent(content: unknown, msgType: string): string {
  let normalizedContent = content;
  if (typeof content === "string" && /^[\[{]/.test(content.trim())) {
    try {
      normalizedContent = JSON.parse(content);
    } catch {
      normalizedContent = content;
    }
  }
  const text = textOf(normalizedContent).trim();
  const readableText = compactMessageMarkup(text);
  if (readableText && !looksLikeOpaqueJson(readableText)) return truncate(stripHighlights(readableText), SUMMARY_LIMIT);
  const placeholders: Record<string, string> = {
    image: "[图片]",
    file: "[文件]",
    audio: "[语音]",
    video: "[视频]",
    media: "[媒体]",
    sticker: "[表情]",
    interactive: "[互动卡片]",
    share_chat: "[群名片]",
    share_user: "[个人名片]",
    merge_forward: "[合并转发]",
    system: "[系统消息]",
    post: "[富文本消息]"
  };
  return placeholders[msgType] || `[${msgType || "未知类型"}消息]`;
}

function isGeneratedMemoryCard(content: unknown, msgType: string): boolean {
  if (msgType.toLowerCase() !== "interactive") return false;
  return /本周信息足迹|个人信息记忆/.test(decodeHtmlEntities(textOf(content)));
}

function compactMessageMarkup(value: string): string {
  const decoded = decodeHtmlEntities(value).replace(/\r/g, "").trim();
  if (!decoded) return "";
  const rootTitle = decoded.match(/^<(?:card|calendar_share)\b[^>]*\btitle="([^"]+)"/i)?.[1] || "";
  const cleanTitle = cleanMessageLine(rootTitle.replace(/^\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}\s*[：:]\s*/, ""));
  const body = decoded
    .replace(/<\/?(?:card|calendar_share)\b[^>]*>/gi, "\n")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, (_match, label: string) => /^https?:\/\//i.test(label) ? "" : label)
    .replace(/<[^>]+>/g, "\n");
  const lines = body.split("\n")
    .map(cleanMessageLine)
    .filter(Boolean)
    .filter((line) => !/^[-—–]{3,}$/.test(line))
    .filter((line) => !/^https?:\/\//i.test(line))
    .filter((line) => !/^(?:🖼️\s*)?Image\b/i.test(line))
    .filter((line) => !/^(?:来自|📚\s*前往知识库|前往知识库)/.test(line))
    .filter((line) => !/^\[video call\]$/i.test(line));
  const uniqueLines = unique(lines.filter((line) => line !== cleanTitle));
  if (cleanTitle && uniqueLines.length) return `${cleanTitle}｜${uniqueLines.slice(0, 2).join("；")}`;
  if (cleanTitle) return cleanTitle;
  if (uniqueLines.length) return uniqueLines.slice(0, 3).join("；");
  return decoded.startsWith("<") ? "" : cleanMessageLine(decoded);
}

function cleanMessageLine(value: string): string {
  return value
    .replace(/^\s*[•·*-]\s*/, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&amp;/gi, "&");
}

function looksLikeOpaqueJson(value: string): boolean {
  return value.startsWith("{") && value.endsWith("}") && value.length > SUMMARY_LIMIT;
}

function formatCellDate(value: unknown, fallback: Date): string {
  const date = parseDate(value) || fallback;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = textOf(value);
  if (!raw) return null;
  if (/^\d{10,13}$/.test(raw)) {
    const millis = raw.length === 10 ? Number(raw) * 1000 : Number(raw);
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function compareCellDate(left: string, right: string): number {
  return left.localeCompare(right);
}

function toShanghaiRfc3339(value: string): string {
  const date = new Date(value);
  const cell = formatCellDate(date, date).replace(" ", "T");
  return `${cell}+08:00`;
}

function responseData(envelope: JsonRecord): JsonRecord {
  return Object.keys(asRecord(envelope.data)).length ? asRecord(envelope.data) : envelope;
}

function extractArray(envelope: JsonRecord, keys: string[]): JsonRecord[] {
  const data = responseData(envelope);
  for (const key of keys) {
    const direct = data[key] ?? envelope[key];
    if (Array.isArray(direct)) return direct.map(asRecord);
  }
  return [];
}

function findDeepString(value: unknown, keys: string[], pattern?: RegExp): string {
  if (!value || typeof value !== "object") return "";
  const record = asRecord(value);
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && (!pattern || pattern.test(candidate))) return candidate;
  }
  for (const candidate of Object.values(record)) {
    const found = findDeepString(candidate, keys, pattern);
    if (found) return found;
  }
  return "";
}

function findDeepMatchingString(value: unknown, pattern: RegExp): string {
  if (typeof value === "string") return pattern.test(value) ? value : "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeepMatchingString(item, pattern);
      if (found) return found;
    }
    return "";
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as JsonRecord)) {
      const found = findDeepMatchingString(item, pattern);
      if (found) return found;
    }
  }
  return "";
}

function firstString(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return "";
}

function firstDefined(record: JsonRecord, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key];
  return undefined;
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ").trim();
  const record = asRecord(value);
  for (const key of ["text", "content", "value", "name", "title"]) {
    const text = textOf(record[key]);
    if (text) return text;
  }
  return "";
}

function normalizeSelectCell(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean);
  const text = textOf(value);
  return text ? [text] : [];
}

function checkboxValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = textOf(value).toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "是";
}

function stripHighlights(value: string): string {
  return value.replace(/<\/?h[b]?>/gi, "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runLarkCommand(args: string[], label: string): JsonRecord {
  const result = spawnLarkCli(args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1"
    }
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  const raw = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  let envelope: JsonRecord;
  try {
    envelope = JSON.parse(raw) as JsonRecord;
  } catch {
    throw new Error(`${label}: lark-cli returned non-JSON output (exit ${result.status ?? 1}).`);
  }
  if (result.status !== 0 || envelope.ok === false) {
    const apiError = asRecord(envelope.error);
    const failure = new Error(`${label}: ${String(apiError.message || apiError.hint || `lark-cli exited with ${result.status ?? 1}`)}`) as CommandFailure;
    failure.envelope = envelope;
    failure.exitCode = result.status ?? 1;
    throw failure;
  }
  return envelope;
}
