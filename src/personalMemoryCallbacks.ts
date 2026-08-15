import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { spawnLarkCli, spawnLarkCliProcess } from "./larkCliProcess.js";
import {
  buildKeepViewUrl,
  ensureBaseInitialized,
  listExistingRecords,
  loadPersonalInboxConfig,
  markPersonalMemoryHighlights,
  savePersonalInboxCommunityChats,
  type PersonalInboxCommandRunner,
  type PersonalMemoryRecord
} from "./personalInbox.js";

type JsonRecord = Record<string, unknown>;

export interface CardActionEvent extends JsonRecord {
  event_id?: string;
  operator_id?: string;
  message_id?: string;
  token?: string;
  action_name?: string;
  action_value?: string;
  form_value?: string;
  card_content?: string;
}

export interface MemoryListenOptions {
  rootDir: string;
  profile: string;
  maxEvents?: number;
  timeout?: string;
  json?: boolean;
  runner?: PersonalInboxCommandRunner;
}

interface KeepPayload {
  action: "keep_weekly_highlights";
  version: 1;
  owner_open_id: string;
  review_key: string;
  record_ids: string[];
  detail_page_url?: string;
  keep_view_url?: string;
}

export interface CommunityChatCandidate {
  chatId: string;
  name: string;
  chatMode: string;
}

export interface AdjustCommunitiesPayload {
  action: "adjust_community_chats";
  version: 1;
  owner_open_id: string;
  review_key: string;
}

interface AdjustCommunitiesSession extends AdjustCommunitiesPayload {
  candidate_chats: CommunityChatCandidate[];
}

interface CallbackState {
  processedEventIds: string[];
  snapshots: Record<string, JsonRecord>;
  actionPayloads: Record<string, JsonRecord>;
}

export async function listenPersonalMemoryCallbacks(options: MemoryListenOptions): Promise<number> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.profile)) throw new Error("Invalid lark-cli profile name.");
  const rawRunner = options.runner || runLarkCommand;
  const runner: PersonalInboxCommandRunner = (args, label) => rawRunner(["--profile", options.profile, ...args], label);
  const config = loadPersonalInboxConfig(options.rootDir, options.profile);
  if (!config) throw new Error(`未找到 ${options.profile} 的个人信息记忆配置，请先执行一次 personal-inbox 同步。`);
  ensureBaseInitialized(runner, options.rootDir, config, options.profile);

  const args = ["--profile", options.profile, "event", "consume", "card.action.trigger", "--as", "bot"];
  if (options.maxEvents !== undefined) args.push("--max-events", String(options.maxEvents));
  if (options.timeout) args.push("--timeout", options.timeout);
  const child = spawnLarkCliProcess(args, {
    env: {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1"
    }
  });
  const statePath = callbackStatePath(options.rootDir, options.profile);
  let buffer = "";
  let chain = Promise.resolve();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (options.json) process.stderr.write(chunk);
    else process.stderr.write(chunk.replace(/^\[event\] ready.*$/m, "[memory] 卡片回调监听器已就绪"));
  });
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines.map((item) => item.trim()).filter(Boolean)) {
      chain = chain.then(async () => {
        let event: CardActionEvent;
        try {
          event = JSON.parse(line) as CardActionEvent;
        } catch {
          process.stderr.write(`[memory] 忽略无法解析的事件：${line.slice(0, 160)}\n`);
          return;
        }
        const result = handlePersonalMemoryCardAction({
          event,
          rootDir: options.rootDir,
          profile: options.profile,
          runner,
          statePath
        });
        const output = JSON.stringify(result);
        process.stdout.write(options.json ? `${output}\n` : `${formatResult(result)}\n`);
      });
    }
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 0));
  });
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer) as CardActionEvent;
      const result = handlePersonalMemoryCardAction({ event, rootDir: options.rootDir, profile: options.profile, runner, statePath });
      process.stdout.write(options.json ? `${JSON.stringify(result)}\n` : `${formatResult(result)}\n`);
    } catch {
      process.stderr.write("[memory] 忽略末尾不完整的事件。\n");
    }
  }
  await chain;
  return exitCode;
}

export function handlePersonalMemoryCardAction(options: {
  event: CardActionEvent;
  rootDir: string;
  profile: string;
  runner: PersonalInboxCommandRunner;
  statePath?: string;
  now?: Date;
}): JsonRecord {
  const { event, runner } = options;
  const eventId = String(event.event_id || "");
  const messageId = String(event.message_id || "");
  const token = String(event.token || "");
  const statePath = options.statePath || callbackStatePath(options.rootDir, options.profile);
  const state = loadState(statePath);
  if (eventId && state.processedEventIds.includes(eventId)) return { status: "duplicate", eventId };
  if (!messageId || !token) return finish(statePath, state, eventId, { status: "ignored", reason: "missing_message_or_token" });

  const currentCard = parseObject(event.card_content);
  const action = parseObject(event.action_value);
  const deliveredSnapshot = loadDeliveredCardSnapshot(options.rootDir, options.profile, messageId);
  const snapshot = nonEmptyObject(state.snapshots[messageId]) || deliveredSnapshot;
  const savedAction = state.actionPayloads[messageId];
  const communityPayload = isAdjustCommunitiesPayload(action)
    ? action
    : isAdjustCommunitiesSession(savedAction) ? savedAction : null;
  const isCommunityEvent = Boolean(communityPayload)
    || action.action === "cancel_adjust_community_chats"
    || event.action_name === "confirm_adjust_community_chats";

  if (isCommunityEvent) {
    return handleCommunityChatAction({
      ...options,
      eventId,
      messageId,
      token,
      statePath,
      state,
      currentCard,
      snapshot,
      action,
      payload: communityPayload
    });
  }

  const originalPayload = snapshot ? findKeepPayload(snapshot) : null;
  const payload = isKeepPayload(action)
    ? action
    : isKeepPayload(savedAction) ? savedAction : originalPayload;

  if (!payload) {
    delayedUpdate(runner, token, buildUnsupportedCard());
    return finish(statePath, state, eventId, { status: "unsupported", messageId });
  }
  if (event.operator_id !== payload.owner_open_id) {
    delayedUpdate(runner, token, buildOwnerRejectedCard(currentCard));
    return finish(statePath, state, eventId, { status: "rejected", reason: "owner_mismatch", messageId });
  }

  if (action.action === "cancel_keep_weekly_highlights") {
    if (snapshot) delayedUpdate(runner, token, snapshot);
    else delayedUpdate(runner, token, buildUnsupportedCard());
    delete state.snapshots[messageId];
    delete state.actionPayloads[messageId];
    return finish(statePath, state, eventId, { status: "cancelled", messageId });
  }

  const config = loadPersonalInboxConfig(options.rootDir, options.profile);
  if (!config) throw new Error(`未找到 ${options.profile} 的个人信息记忆配置。`);
  const recordsById = new Map([...listExistingRecords(runner, config).values()].map((record) => [record.recordId, record]));
  const candidates = payload.record_ids.map((recordId) => recordsById.get(recordId)).filter((record): record is PersonalMemoryRecord => Boolean(record));
  if (candidates.length !== payload.record_ids.length) {
    const card = buildKeepSelectionCard(candidates, payload, { error: "部分候选已不存在，请发送一张新版周报卡后重试。" });
    delayedUpdate(runner, token, card);
    return finish(statePath, state, eventId, { status: "error", reason: "candidate_mismatch", messageId });
  }

  const isSubmit = event.action_name === "confirm_keep_weekly_highlights" || Boolean(event.form_value);
  if (!isSubmit) {
    state.snapshots[messageId] = nonEmptyObject(currentCard) || snapshot || {};
    state.actionPayloads[messageId] = payload as unknown as JsonRecord;
    trimSnapshots(state);
    saveState(statePath, state);
    delayedUpdate(runner, token, buildKeepSelectionCard(candidates, payload));
    return finish(statePath, state, eventId, { status: "selecting", messageId, candidates: candidates.length });
  }

  const form = parseObject(event.form_value);
  const selected = payload.record_ids.filter((recordId) => truthy(form[`keep_${recordId}`]));
  const newRecordIds = selected.filter((recordId) => !recordsById.get(recordId)?.kept);
  if (!newRecordIds.length) {
    const error = selected.length ? "所选内容已经全部保留，请再选择至少 1 条新内容。" : "请至少选择 1 条新内容。";
    delayedUpdate(runner, token, buildKeepSelectionCard(candidates, payload, { error, selectedRecordIds: selected }));
    return finish(statePath, state, eventId, { status: "selecting", reason: "zero_new_selection", messageId });
  }
  try {
    markPersonalMemoryHighlights(runner, config, newRecordIds, options.now || new Date());
    const chosen = candidates.filter((record) => newRecordIds.includes(record.recordId));
    delayedUpdate(runner, token, buildKeepSuccessCard(chosen, payload, payload.keep_view_url || buildKeepViewUrl(config)));
    delete state.snapshots[messageId];
    delete state.actionPayloads[messageId];
    return finish(statePath, state, eventId, { status: "kept", messageId, count: chosen.length, recordIds: newRecordIds });
  } catch (error) {
    delayedUpdate(runner, token, buildKeepSelectionCard(candidates, payload, {
      error: `写入失败：${error instanceof Error ? error.message : String(error)}。请重试。`,
      selectedRecordIds: selected
    }));
    return finish(statePath, state, eventId, { status: "error", reason: "write_failed", messageId });
  }
}

function handleCommunityChatAction(options: {
  event: CardActionEvent;
  rootDir: string;
  profile: string;
  runner: PersonalInboxCommandRunner;
  now?: Date;
  eventId: string;
  messageId: string;
  token: string;
  statePath: string;
  state: CallbackState;
  currentCard: JsonRecord;
  snapshot: JsonRecord | null;
  action: JsonRecord;
  payload: AdjustCommunitiesPayload | AdjustCommunitiesSession | null;
}): JsonRecord {
  const { event, runner, eventId, messageId, token, statePath, state, currentCard, snapshot, action } = options;
  const payload = options.payload;
  if (!payload) {
    delayedUpdate(runner, token, buildUnsupportedCard());
    return finish(statePath, state, eventId, { status: "unsupported", messageId });
  }
  if (event.operator_id !== payload.owner_open_id) {
    delayedUpdate(runner, token, buildOwnerRejectedCard(currentCard));
    return finish(statePath, state, eventId, { status: "rejected", reason: "owner_mismatch", messageId });
  }
  if (action.action === "cancel_adjust_community_chats") {
    delayedUpdate(runner, token, snapshot || buildUnsupportedCard());
    delete state.snapshots[messageId];
    delete state.actionPayloads[messageId];
    return finish(statePath, state, eventId, { status: "cancelled", flow: "communities", messageId });
  }

  const config = loadPersonalInboxConfig(options.rootDir, options.profile);
  if (!config) throw new Error(`未找到 ${options.profile} 的个人信息记忆配置。`);
  const savedSession = isAdjustCommunitiesSession(state.actionPayloads[messageId])
    ? state.actionPayloads[messageId] as unknown as AdjustCommunitiesSession
    : null;
  const candidates = savedSession?.candidate_chats || listCommunityChatCandidates(runner, config.communityChatIds || [], config.communityChats || []);
  const isSubmit = event.action_name === "confirm_adjust_community_chats" || Boolean(event.form_value);

  if (!isSubmit) {
    const session: AdjustCommunitiesSession = { ...payload, candidate_chats: candidates };
    state.snapshots[messageId] = nonEmptyObject(currentCard) || snapshot || {};
    state.actionPayloads[messageId] = session as unknown as JsonRecord;
    trimSnapshots(state);
    saveState(statePath, state);
    delayedUpdate(runner, token, buildCommunityChatSelectionCard(candidates, config.communityChatIds || [], payload));
    return finish(statePath, state, eventId, { status: "selecting_communities", messageId, candidates: candidates.length });
  }

  const form = parseObject(event.form_value);
  const selectedIds = candidates.map((chat) => chat.chatId).filter((chatId) => truthy(form[`community_${chatId}`]));
  if (!selectedIds.length) {
    delayedUpdate(runner, token, buildCommunityChatSelectionCard(candidates, config.communityChatIds || [], payload, {
      error: "请至少选择 1 个关注社群。"
    }));
    return finish(statePath, state, eventId, { status: "selecting_communities", reason: "zero_selection", messageId });
  }
  const selectedChats = candidates.filter((chat) => selectedIds.includes(chat.chatId));
  try {
    savePersonalInboxCommunityChats(options.rootDir, options.profile, selectedChats.map((chat) => ({ chatId: chat.chatId, name: chat.name })));
    delayedUpdate(runner, token, buildCommunityChatSuccessCard(selectedChats));
    delete state.snapshots[messageId];
    delete state.actionPayloads[messageId];
    return finish(statePath, state, eventId, {
      status: "communities_updated",
      messageId,
      count: selectedChats.length,
      chatIds: selectedIds
    });
  } catch (error) {
    delayedUpdate(runner, token, buildCommunityChatSelectionCard(candidates, config.communityChatIds || [], payload, {
      error: `保存失败：${error instanceof Error ? error.message : String(error)}。请重试。`,
      selectedChatIds: selectedIds
    }));
    return finish(statePath, state, eventId, { status: "error", reason: "community_write_failed", messageId });
  }
}

export function buildCommunityChatSelectionCard(
  chats: CommunityChatCandidate[],
  currentChatIds: string[],
  payload: AdjustCommunitiesPayload,
  options: { error?: string; selectedChatIds?: string[] } = {}
): JsonRecord {
  const selected = new Set(options.selectedChatIds || currentChatIds);
  const elements: JsonRecord[] = [];
  if (options.error) elements.push({ tag: "markdown", content: `**<font color='red'>${cardText(options.error)}</font>**` });
  elements.push({
    tag: "column_set",
    flex_mode: "none",
    background_style: "blue-50",
    columns: [{
      tag: "column",
      width: "weighted",
      weight: 1,
      padding: "12px",
      elements: [{ tag: "markdown", content: `**当前关注 ${currentChatIds.length} 个社群**\n<font color='grey'>调整后的名单将在下一次信息足迹同步时生效。</font>` }]
    }]
  });
  const formElements: JsonRecord[] = chats.map((chat) => ({
    tag: "checker",
    name: `community_${chat.chatId}`,
    checked: selected.has(chat.chatId),
    text: {
      tag: "plain_text",
      content: `${truncate(chat.name, 62)}${chat.chatMode === "topic" ? " · 话题群" : ""}`
    }
  }));
  formElements.push({
    tag: "button",
    name: "confirm_adjust_community_chats",
    text: { tag: "plain_text", content: "保存关注社群" },
    type: "primary_filled",
    width: "fill",
    form_action_type: "submit"
  });
  elements.push({ tag: "form", name: "adjust_community_chats_form", vertical_spacing: "medium", elements: formElements });
  elements.push({
    tag: "button",
    text: { tag: "plain_text", content: "取消" },
    type: "default",
    width: "fill",
    behaviors: [{
      type: "callback",
      value: {
        action: "cancel_adjust_community_chats",
        version: 1,
        owner_open_id: payload.owner_open_id,
        review_key: payload.review_key
      }
    }]
  });
  return cardShell("调整关注社群", "选择周报持续关注的信息来源", "blue", elements);
}

export function buildCommunityChatSuccessCard(chats: CommunityChatCandidate[]): JsonRecord {
  const lines = chats.map((chat) => `• ${cardText(chat.name)}`).join("\n");
  return cardShell("关注社群已更新", `已关注 ${chats.length} 个社群`, "green", [
    {
      tag: "column_set",
      flex_mode: "none",
      background_style: "green-50",
      columns: [{
        tag: "column",
        width: "weighted",
        weight: 1,
        padding: "12px",
        elements: [{ tag: "markdown", content: `**新的关注名单**\n${lines}` }]
      }]
    },
    { tag: "markdown", content: "<font color='grey'>设置已保存，将在下一次“本周信息足迹”同步时生效。</font>" }
  ]);
}

export function listCommunityChatCandidates(
  runner: PersonalInboxCommandRunner,
  currentChatIds: string[],
  savedChats: Array<{ chatId: string; name: string }> = []
): CommunityChatCandidate[] {
  const discovered: CommunityChatCandidate[] = [];
  let pageToken = "";
  for (let page = 0; page < 3; page += 1) {
    const envelope = runner([
      "im", "+chat-list", "--sort", "active_time", "--page-size", "50",
      ...(pageToken ? ["--page-token", pageToken] : []),
      "--as", "user", "--format", "json"
    ], `list community chat candidates page ${page + 1}`);
    const data = asRecord(envelope.data);
    const chats = Array.isArray(data.chats) ? data.chats.map(asRecord) : [];
    for (const chat of chats) {
      const chatId = String(chat.chat_id || "");
      const status = String(chat.chat_status || "normal");
      const mode = String(chat.chat_mode || "group");
      if (!/^oc_[A-Za-z0-9_-]+$/.test(chatId) || status !== "normal" || !["group", "topic"].includes(mode)) continue;
      if (!discovered.some((item) => item.chatId === chatId)) {
        discovered.push({ chatId, name: String(chat.name || chatId), chatMode: mode });
      }
    }
    const hasAllCurrent = currentChatIds.every((chatId) => discovered.some((chat) => chat.chatId === chatId));
    if (hasAllCurrent || !data.has_more) break;
    pageToken = String(data.page_token || "");
    if (!pageToken) break;
  }
  const fallbackCurrent = savedChats
    .filter((chat) => currentChatIds.includes(chat.chatId))
    .map((chat) => ({ chatId: chat.chatId, name: chat.name, chatMode: "group" }));
  const all = [...fallbackCurrent, ...discovered].filter((chat, index, items) => items.findIndex((item) => item.chatId === chat.chatId) === index);
  const current = all.filter((chat) => currentChatIds.includes(chat.chatId));
  const recent = all.filter((chat) => !currentChatIds.includes(chat.chatId));
  return [...current, ...recent].slice(0, 15);
}

export function buildKeepSelectionCard(
  records: PersonalMemoryRecord[],
  payload: KeepPayload,
  options: { error?: string; selectedRecordIds?: string[] } = {}
): JsonRecord {
  const selected = new Set(options.selectedRecordIds || []);
  const elements: JsonRecord[] = [];
  if (options.error) elements.push({ tag: "markdown", content: `**<font color='red'>${cardText(options.error)}</font>**` });
  elements.push({ tag: "markdown", content: "<font color='grey'>从本周候选中勾选想长期记住的内容。已保留的条目不可取消。</font>" });
  const formElements: JsonRecord[] = [];
  for (const section of ["我的足迹", "社群发现"] as const) {
    const group = records.filter((record) => record.section === section);
    if (!group.length) continue;
    formElements.push({ tag: "markdown", content: `**${section}**`, text_size: "heading-3" });
    for (const record of group) {
      formElements.push({
        tag: "checker",
        name: `keep_${record.recordId}`,
        checked: record.kept || selected.has(record.recordId),
        disabled: record.kept,
        ...(record.kept
          ? { disabled_tips: { tag: "plain_text", content: "已在重点库中" } }
          : {}),
        text: { tag: "plain_text", content: `${truncate(record.title, 68)}${record.sourceName ? ` · ${truncate(record.sourceName, 18)}` : ""}` }
      });
    }
  }
  formElements.push({
    tag: "button",
    name: "confirm_keep_weekly_highlights",
    text: { tag: "plain_text", content: "确认保留" },
    type: "primary_filled",
    width: "fill",
    form_action_type: "submit"
  });
  elements.push({ tag: "form", name: "keep_weekly_highlights_form", vertical_spacing: "medium", elements: formElements });
  elements.push({
    tag: "button",
    text: { tag: "plain_text", content: "取消" },
    type: "default",
    width: "fill",
    behaviors: [{ type: "callback", value: { action: "cancel_keep_weekly_highlights", version: 1, owner_open_id: payload.owner_open_id, review_key: payload.review_key } }]
  });
  return cardShell("保留本周重点", "勾选后写入个人信息记忆", "blue", elements);
}

export function buildKeepSuccessCard(records: PersonalMemoryRecord[], payload: KeepPayload, keepViewUrl: string): JsonRecord {
  const items = records.map((record) => `• ${cardText(record.title)}`).join("\n");
  const buttons: JsonRecord[] = [];
  if (keepViewUrl) buttons.push(openUrlButton("查看重点库", keepViewUrl, "primary_filled"));
  if (payload.detail_page_url) buttons.push(openUrlButton("查看完整回顾", payload.detail_page_url, "default"));
  return cardShell("本周重点已保留", `已保留 ${records.length} 条`, "green", [
    { tag: "markdown", content: `✅ **已保留 ${records.length} 条**\n${items}` },
    ...(buttons.length ? [{ tag: "column_set", flex_mode: "bisect", horizontal_spacing: "small", columns: buttons.map(buttonColumn) }] : [])
  ]);
}

function cardShell(title: string, subtitle: string, template: string, elements: JsonRecord[]): JsonRecord {
  return {
    schema: "2.0",
    config: { update_multi: true, width_mode: "default", enable_forward: false, summary: { content: title } },
    header: {
      title: { tag: "plain_text", content: title },
      subtitle: { tag: "plain_text", content: subtitle },
      template,
      icon: { tag: "standard_icon", token: "myai_colorful" }
    },
    body: { direction: "vertical", padding: "12px 12px 20px 12px", vertical_spacing: "large", elements }
  };
}

function buildUnsupportedCard(): JsonRecord {
  return cardShell("请使用新版周报卡", "旧版卡片没有安全的数据绑定", "grey", [
    { tag: "markdown", content: "这张卡缺少候选记录 ID，因此没有写入重点库。请重新同步并发送一张新版“本周信息足迹”。" }
  ]);
}

function buildOwnerRejectedCard(current: JsonRecord): JsonRecord {
  if (!Object.keys(current).length) return buildUnsupportedCard();
  const card = structuredClone(current);
  const body = asRecord(card.body);
  const elements = Array.isArray(body.elements) ? body.elements : [];
  body.elements = [{ tag: "markdown", content: "**<font color='red'>仅卡片所有者可以保留重点。</font>**" }, ...elements];
  card.body = body;
  return card;
}

function delayedUpdate(runner: PersonalInboxCommandRunner, token: string, card: JsonRecord): void {
  runner([
    "api", "POST", "/open-apis/interactive/v1/card/update", "--as", "bot",
    "--data", JSON.stringify({ token, card }), "--format", "json"
  ], "update personal memory card");
}

function findKeepPayload(card: JsonRecord): KeepPayload | null {
  const stack: unknown[] = [card];
  while (stack.length) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    const record = asRecord(value);
    if (!Object.keys(record).length) continue;
    if (isKeepPayload(record.value)) return record.value;
    stack.push(...Object.values(record));
  }
  return null;
}

function isKeepPayload(value: unknown): value is KeepPayload {
  const record = asRecord(value);
  return record.action === "keep_weekly_highlights"
    && record.version === 1
    && typeof record.owner_open_id === "string"
    && typeof record.review_key === "string"
    && Array.isArray(record.record_ids)
    && record.record_ids.length > 0
    && record.record_ids.length <= 9
    && record.record_ids.every((id) => typeof id === "string" && /^rec[A-Za-z0-9_-]+$/.test(id));
}

function isAdjustCommunitiesPayload(value: unknown): value is AdjustCommunitiesPayload {
  const record = asRecord(value);
  return record.action === "adjust_community_chats"
    && record.version === 1
    && typeof record.owner_open_id === "string"
    && typeof record.review_key === "string";
}

function isAdjustCommunitiesSession(value: unknown): value is AdjustCommunitiesSession {
  const record = asRecord(value);
  return isAdjustCommunitiesPayload(record)
    && Array.isArray(record.candidate_chats)
    && record.candidate_chats.every((chat) => {
      const item = asRecord(chat);
      return /^oc_[A-Za-z0-9_-]+$/.test(String(item.chatId || "")) && typeof item.name === "string";
    });
}

function parseObject(value: unknown): JsonRecord {
  if (typeof value === "string" && value.trim()) {
    try { return asRecord(JSON.parse(value)); } catch { return {}; }
  }
  return asRecord(value);
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || String(value).toLowerCase() === "true" || String(value) === "1";
}

function openUrlButton(text: string, url: string, type: string): JsonRecord {
  return { tag: "button", text: { tag: "plain_text", content: text }, type, width: "fill", behaviors: [{ type: "open_url", default_url: url }] };
}

function buttonColumn(button: JsonRecord): JsonRecord {
  return { tag: "column", width: "weighted", weight: 1, elements: [button] };
}

function cardText(value: string): string {
  return value.replace(/&/g, "＆").replace(/</g, "‹").replace(/>/g, "›").replace(/([\\`*_{}\[\]()#+\-.!|~])/g, "\\$1").replace(/\s+/g, " ").trim();
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1))}…`;
}

function callbackStatePath(rootDir: string, profile: string): string {
  return join(rootDir, ".larkwing", "personal-memory-callbacks", profile, "state.json");
}

function loadDeliveredCardSnapshot(rootDir: string, profile: string, messageId: string): JsonRecord | null {
  const path = join(rootDir, ".larkwing", "personal-memory-callbacks", profile, "cards", `${messageId}.json`);
  if (!existsSync(path)) return null;
  try {
    return nonEmptyObject(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

function nonEmptyObject(value: unknown): JsonRecord | null {
  const record = asRecord(value);
  return Object.keys(record).length ? record : null;
}

function loadState(path: string): CallbackState {
  if (!existsSync(path)) return { processedEventIds: [], snapshots: {}, actionPayloads: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CallbackState;
    return {
      processedEventIds: Array.isArray(parsed.processedEventIds) ? parsed.processedEventIds : [],
      snapshots: asRecord(parsed.snapshots) as Record<string, JsonRecord>,
      actionPayloads: asRecord(parsed.actionPayloads) as Record<string, JsonRecord>
    };
  } catch {
    return { processedEventIds: [], snapshots: {}, actionPayloads: {} };
  }
}

function saveState(path: string, state: CallbackState): void {
  const directory = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
  mkdirSync(directory, { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

function finish(path: string, state: CallbackState, eventId: string, result: JsonRecord): JsonRecord {
  if (eventId) state.processedEventIds = [...state.processedEventIds.filter((id) => id !== eventId), eventId].slice(-500);
  saveState(path, state);
  return { ...result, ...(eventId ? { eventId } : {}) };
}

function trimSnapshots(state: CallbackState): void {
  const entries = Object.entries(state.snapshots);
  if (entries.length > 50) state.snapshots = Object.fromEntries(entries.slice(-50));
}

function formatResult(result: JsonRecord): string {
  if (result.status === "kept") return `[memory] 已保留 ${result.count} 条重点。`;
  if (result.status === "selecting") return `[memory] 卡片已进入重点选择态。`;
  if (result.status === "selecting_communities") return `[memory] 卡片已进入关注社群选择态。`;
  if (result.status === "communities_updated") return `[memory] 已更新 ${result.count} 个关注社群。`;
  if (result.status === "cancelled") return `[memory] 已恢复原周报卡。`;
  if (result.status === "duplicate") return `[memory] 已忽略重复事件。`;
  return `[memory] ${String(result.status || "processed")}${result.reason ? `：${String(result.reason)}` : ""}`;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function runLarkCommand(args: string[], label: string): JsonRecord {
  const result = spawnLarkCli(args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" }
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  const raw = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  let envelope: JsonRecord;
  try { envelope = JSON.parse(raw) as JsonRecord; } catch { throw new Error(`${label}: lark-cli returned non-JSON output.`); }
  if (result.status !== 0 || envelope.ok === false) {
    const error = asRecord(envelope.error);
    throw new Error(`${label}: ${String(error.message || error.hint || `lark-cli exited with ${result.status ?? 1}`)}`);
  }
  return envelope;
}
