import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildSyncWindow, buildWeeklyMemoryReview, bindWeeklyReviewRecords, buildWeeklyMemoryCard } from "../dist/personalInbox.js";
import {
  buildCommunityChatSelectionCard,
  buildKeepSelectionCard,
  handlePersonalMemoryCardAction,
  listCommunityChatCandidates
} from "../dist/personalMemoryCallbacks.js";

test("weekly keep candidates are limited to four personal and five community records", () => {
  const now = new Date("2026-08-15T04:00:00.000Z");
  const activities = [
    ...Array.from({ length: 6 }, (_, index) => activity(`personal-${index}`, "我的足迹", index)),
    ...Array.from({ length: 7 }, (_, index) => activity(`community-${index}`, "社群发现", index))
  ];
  const review = buildWeeklyMemoryReview(activities, buildSyncWindow(now, 7));
  assert.equal(review.personalHighlights.length, 4);
  assert.equal(review.communityDiscoveries.length, 5);
  const records = new Map(activities.map((item, index) => [item.eventKey, memoryRecord(item, `rec_${index + 1}`)]));
  bindWeeklyReviewRecords(review, records);
  const card = buildWeeklyMemoryCard(review, { ownerOpenId: "ou_owner", keepViewUrl: "https://example/base?view=vew_keep" });
  const keep = findAction(card, "keep_weekly_highlights");
  assert.equal(keep.record_ids.length, 9);
  assert.equal(card.config.enable_forward, false);
});

test("selection card checks and disables already-kept records", () => {
  const records = [
    { ...memoryRecord(activity("one", "我的足迹", 1), "rec_one"), kept: true },
    memoryRecord(activity("two", "社群发现", 2), "rec_two")
  ];
  const card = buildKeepSelectionCard(records, payload(["rec_one", "rec_two"]));
  const checkers = collectByTag(card, "checker");
  assert.equal(checkers[0].checked, true);
  assert.equal(checkers[0].disabled, true);
  assert.equal(checkers[1].checked, false);
  assert.equal(checkers[1].disabled, false);
});

test("card callback opens form, rejects empty selection, writes selected records, and deduplicates", (t) => {
  const root = makeRoot(t);
  const fake = callbackRunner([memoryRecord(activity("one", "我的足迹", 1), "rec_one"), memoryRecord(activity("two", "社群发现", 2), "rec_two")]);
  const original = originalCard(payload(["rec_one", "rec_two"]));
  const selecting = handlePersonalMemoryCardAction({
    event: event("evt_open", original, { action: "keep_weekly_highlights", ...payload(["rec_one", "rec_two"]) }),
    rootDir: root,
    profile: "demo-profile",
    runner: fake.runner
  });
  assert.equal(selecting.status, "selecting");
  assert.equal(collectByTag(fake.state.updatedCards.at(-1), "checker").length, 2);

  const empty = handlePersonalMemoryCardAction({
    event: { ...event("evt_empty", fake.state.updatedCards.at(-1), {}), action_name: "confirm_keep_weekly_highlights", form_value: "{}" },
    rootDir: root,
    profile: "demo-profile",
    runner: fake.runner
  });
  assert.equal(empty.reason, "zero_new_selection");
  assert.equal(fake.state.patches.length, 0);

  const kept = handlePersonalMemoryCardAction({
    event: {
      ...event("evt_keep", fake.state.updatedCards.at(-1), {}),
      action_name: "confirm_keep_weekly_highlights",
      form_value: JSON.stringify({ keep_rec_one: true })
    },
    rootDir: root,
    profile: "demo-profile",
    runner: fake.runner,
    now: new Date("2026-08-15T05:06:07.000Z")
  });
  assert.equal(kept.status, "kept");
  assert.deepEqual(fake.state.patches[0].record_id_list, ["rec_one"]);
  assert.equal(fake.state.patches[0].patch["是否重点"], true);
  assert.equal(fake.state.updatedCards.at(-1).header.template, "green");

  const duplicate = handlePersonalMemoryCardAction({
    event: { ...event("evt_keep", fake.state.updatedCards.at(-1), {}), action_name: "confirm_keep_weekly_highlights", form_value: "{}" },
    rootDir: root,
    profile: "demo-profile",
    runner: fake.runner
  });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(fake.state.patches.length, 1);
});

test("card callback rejects a different operator and old unbound cards without writing Base", (t) => {
  const root = makeRoot(t);
  const fake = callbackRunner([memoryRecord(activity("one", "我的足迹", 1), "rec_one")]);
  const ownerCard = originalCard(payload(["rec_one"]));
  const rejected = handlePersonalMemoryCardAction({
    event: { ...event("evt_bad_owner", ownerCard, findAction(ownerCard, "keep_weekly_highlights")), operator_id: "ou_other" },
    rootDir: root,
    profile: "demo-profile",
    runner: fake.runner
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(fake.state.patches.length, 0);

  const old = handlePersonalMemoryCardAction({
    event: event("evt_old", originalCard({ action: "keep_weekly_highlights", review_title: "old" }), { action: "keep_weekly_highlights", review_title: "old" }),
    rootDir: root,
    profile: "demo-profile",
    runner: fake.runner
  });
  assert.equal(old.status, "unsupported");
  assert.equal(fake.state.patches.length, 0);
});

test("cancel restores the original card and a failed write preserves the selected form", (t) => {
  const root = makeRoot(t);
  const record = memoryRecord(activity("one", "我的足迹", 1), "rec_one");
  const fake = callbackRunner([record], { failWrite: true });
  const original = originalCard(payload(["rec_one"]));
  handlePersonalMemoryCardAction({
    event: event("evt_open_for_failure", original, findAction(original, "keep_weekly_highlights")),
    rootDir: root, profile: "demo-profile", runner: fake.runner
  });
  const failed = handlePersonalMemoryCardAction({
    event: {
      ...event("evt_write_failure", fake.state.updatedCards.at(-1), {}),
      action_name: "confirm_keep_weekly_highlights",
      form_value: JSON.stringify({ keep_rec_one: true })
    },
    rootDir: root, profile: "demo-profile", runner: fake.runner
  });
  assert.equal(failed.reason, "write_failed");
  const failedCard = fake.state.updatedCards.at(-1);
  assert.equal(collectByTag(failedCard, "checker")[0].checked, true);
  assert.match(JSON.stringify(failedCard), /写入失败/);

  const cancelled = handlePersonalMemoryCardAction({
    event: {
      ...event("evt_cancel", failedCard, { action: "cancel_keep_weekly_highlights", version: 1, owner_open_id: "ou_owner" }),
      action_value: JSON.stringify({ action: "cancel_keep_weekly_highlights", version: 1, owner_open_id: "ou_owner" })
    },
    rootDir: root, profile: "demo-profile", runner: fake.runner
  });
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(fake.state.updatedCards.at(-1), original);
});

test("community candidates prioritize current normal chats and render checked form items", () => {
  const fake = callbackRunner([], {
    chats: [
      { chat_id: "oc_recent", name: "最近群", chat_mode: "group", chat_status: "normal" },
      { chat_id: "oc_current", name: "当前群", chat_mode: "topic", chat_status: "normal" },
      { chat_id: "oc_dissolved", name: "已解散", chat_mode: "group", chat_status: "dissolved_save" }
    ]
  });
  const candidates = listCommunityChatCandidates(fake.runner, ["oc_current"]);
  assert.deepEqual(candidates.map((chat) => chat.chatId), ["oc_current", "oc_recent"]);
  const card = buildCommunityChatSelectionCard(candidates, ["oc_current"], adjustPayload());
  const checkers = collectByTag(card, "checker");
  assert.equal(checkers.find((checker) => checker.name === "community_oc_current").checked, true);
  assert.equal(checkers.find((checker) => checker.name === "community_oc_recent").checked, false);
});

test("adjust communities callback saves the selected sources and shows success", (t) => {
  const root = makeRoot(t);
  const fake = callbackRunner([], {
    chats: [
      { chat_id: "oc_current", name: "当前群", chat_mode: "group", chat_status: "normal" },
      { chat_id: "oc_new", name: "新增群", chat_mode: "topic", chat_status: "normal" }
    ]
  });
  const original = originalCard(adjustPayload());
  const opened = handlePersonalMemoryCardAction({
    event: event("evt_adjust_open", original, adjustPayload()),
    rootDir: root, profile: "demo-profile", runner: fake.runner
  });
  assert.equal(opened.status, "selecting_communities");
  const selectionCard = fake.state.updatedCards.at(-1);
  assert.equal(collectByTag(selectionCard, "checker").length, 2);

  const saved = handlePersonalMemoryCardAction({
    event: {
      ...event("evt_adjust_save", selectionCard, {}),
      action_name: "confirm_adjust_community_chats",
      form_value: JSON.stringify({ community_oc_current: true, community_oc_new: true })
    },
    rootDir: root, profile: "demo-profile", runner: fake.runner
  });
  assert.equal(saved.status, "communities_updated");
  const config = JSON.parse(readFileSync(join(root, ".larkwing", "personal-inbox.demo-profile.json"), "utf8"));
  assert.deepEqual(config.communityChatIds, ["oc_current", "oc_new"]);
  assert.equal(fake.state.updatedCards.at(-1).header.template, "green");
});

function activity(eventKey, section, index) {
  return {
    eventKey,
    title: `标题 ${eventKey}`,
    activityTime: `2026-08-${String(14 - index).padStart(2, "0")} 10:00:00`,
    contentTime: `2026-08-${String(14 - index).padStart(2, "0")} 10:00:00`,
    behaviors: section === "我的足迹" ? ["发出消息"] : ["社群发现"],
    section,
    signalStrength: section === "我的足迹" ? "主动" : "候选",
    topic: "AI 与技术",
    sourceType: section === "我的足迹" ? "私聊" : "群聊",
    sourceName: section === "我的足迹" ? "我" : "AI 社群",
    sender: "测试用户",
    summary: `可保留的信息 ${eventKey}`,
    sourceId: `source-${eventKey}`,
    evidenceId: `evidence-${eventKey}`,
    sourceUrl: `https://example.feishu.cn/docx/${eventKey}`,
    status: "待整理"
  };
}

function memoryRecord(item, recordId) {
  return { recordId, ...item, kept: false, keptAt: "" };
}

function payload(recordIds) {
  return {
    action: "keep_weekly_highlights",
    version: 1,
    owner_open_id: "ou_owner",
    review_key: "weekly:2026-08-08:2026-08-15",
    record_ids: recordIds,
    detail_page_url: "https://example.feishu.cn/docx/review",
    keep_view_url: "https://example.feishu.cn/base/memory?view=vew_keep"
  };
}

function adjustPayload() {
  return {
    action: "adjust_community_chats",
    version: 1,
    owner_open_id: "ou_owner",
    review_key: "weekly:2026-08-08:2026-08-15"
  };
}

function originalCard(actionPayload) {
  return {
    schema: "2.0",
    config: { enable_forward: false },
    header: { title: { tag: "plain_text", content: "本周信息足迹" }, template: "blue" },
    body: { elements: [{ tag: "button", text: { tag: "plain_text", content: "保留重点" }, behaviors: [{ type: "callback", value: actionPayload }] }] }
  };
}

function event(eventId, card, actionValue) {
  return {
    event_id: eventId,
    operator_id: "ou_owner",
    message_id: "om_weekly",
    token: `token_${eventId}`,
    action_value: JSON.stringify(actionValue),
    card_content: JSON.stringify(card)
  };
}

function makeRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "larkwing-keep-memory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".larkwing"), { recursive: true });
  writeFileSync(join(root, ".larkwing", "personal-inbox.demo-profile.json"), JSON.stringify({
    schemaVersion: 1,
    profile: "demo-profile",
    baseToken: "app_memory",
    tableId: "tbl_memory",
    baseUrl: "https://example.feishu.cn/base/app_memory",
    initialized: true,
    keepViewId: "vew_keep",
    communityChatIds: ["oc_current"],
    communityChats: [{ chatId: "oc_current", name: "当前群" }]
  }), "utf8");
  return root;
}

function callbackRunner(records, options = {}) {
  const state = { records, updatedCards: [], patches: [], chats: options.chats || [] };
  const runner = (args, label) => {
    if (label.startsWith("read existing personal inbox records page")) {
      const fields = repeatedArgValues(args, "--field-id");
      return {
        ok: true,
        data: {
          fields,
          data: records.map((record) => fields.map((field) => recordField(record, field))),
          record_id_list: records.map((record) => record.recordId),
          has_more: false
        }
      };
    }
    if (label === "update personal memory card") {
      state.updatedCards.push(JSON.parse(argValue(args, "--data")).card);
      return { ok: true, data: {} };
    }
    if (label.startsWith("list community chat candidates page")) {
      return { ok: true, data: { chats: state.chats, has_more: false } };
    }
    if (label === "keep personal memory records") {
      if (options.failWrite) throw new Error("simulated Base failure");
      const body = JSON.parse(argValue(args, "--json"));
      state.patches.push(body);
      for (const id of body.record_id_list) {
        const record = records.find((item) => item.recordId === id);
        record.kept = true;
        record.keptAt = body.patch["保留时间"];
      }
      return { ok: true, data: {} };
    }
    throw new Error(`Unexpected callback call: ${label}`);
  };
  return { runner, state };
}

function recordField(record, field) {
  const map = {
    "事件键": record.eventKey, "行为": record.behaviors, "活动时间": record.activityTime, "内容时间": record.contentTime,
    "收件区": record.section, "信号强度": record.signalStrength, "主题": record.topic, "活动": record.title,
    "内容摘要": record.summary, "来源类型": record.sourceType, "来源名称": record.sourceName, "发送人": record.sender,
    "来源ID": record.sourceId, "证据ID": record.evidenceId, "来源链接": record.sourceUrl, "是否重点": record.kept, "保留时间": record.keptAt
  };
  return map[field] ?? null;
}

function findAction(value, actionName) {
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) { stack.push(...current); continue; }
    if (!current || typeof current !== "object") continue;
    if (current.value?.action === actionName) return current.value;
    stack.push(...Object.values(current));
  }
  return null;
}

function collectByTag(value, tag) {
  const found = [];
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) { stack.push(...current); continue; }
    if (!current || typeof current !== "object") continue;
    if (current.tag === tag) found.push(current);
    stack.push(...Object.values(current));
  }
  return found.reverse();
}

function argValue(args, name) {
  return args[args.indexOf(name) + 1];
}

function repeatedArgValues(args, name) {
  return args.flatMap((value, index) => value === name ? [args[index + 1]] : []);
}
