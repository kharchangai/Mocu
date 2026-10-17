// Language Tutor - Mocu extension backend
// Each conversation is stored as a JSON file under ./conversations/.
// Learner-wide grammar progress is stored separately in learner-progress.json.

import { createExtension } from "@mocu/extension-sdk";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const TUTOR_AGENT_NAME = "هم‌صحبت انگلیسی";
const CONVERSATIONS_DIR_NAME = "conversations";
const PROGRESS_FILE_NAME = "learner-progress.json";
const MAX_HISTORY_TURNS = 40;

function extensionRoot() {
  return process.env.MOCU_EXTENSION_ROOT || process.cwd();
}

function conversationsDir() {
  const dir = path.join(extensionRoot(), CONVERSATIONS_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function progressPath() {
  return path.join(extensionRoot(), PROGRESS_FILE_NAME);
}

function readLearnerProgress() {
  const fallback = { version: 1, conversationSequence: 0, issues: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(progressPath(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    const progress = {
      version: 1,
      conversationSequence: Number.isInteger(parsed.conversationSequence) && parsed.conversationSequence >= 0
        ? parsed.conversationSequence
        : 0,
      issues: parsed.issues && typeof parsed.issues === "object" && !Array.isArray(parsed.issues)
        ? parsed.issues
        : {},
    };

    for (const [id, issue] of Object.entries(progress.issues)) {
      if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
        delete progress.issues[id];
        continue;
      }
      issue.id = id;
      issue.rule = typeof issue.rule === "string" ? issue.rule : id;
      issue.original = typeof issue.original === "string" ? issue.original : "";
      issue.correction = typeof issue.correction === "string" ? issue.correction : "";
      issue.explanation = typeof issue.explanation === "string" ? issue.explanation : "";
      issue.firstSeenAt = issue.firstSeenAt || new Date().toISOString();
      issue.lastSeenAt = issue.lastSeenAt || issue.firstSeenAt;
      issue.cycleAttempts = Number.isInteger(issue.cycleAttempts) && issue.cycleAttempts >= 0 ? issue.cycleAttempts : 0;
      issue.totalAttempts = Number.isInteger(issue.totalAttempts) && issue.totalAttempts >= 0 ? issue.totalAttempts : 0;
      issue.correctStreak = Number.isInteger(issue.correctStreak) && issue.correctStreak >= 0 ? issue.correctStreak : 0;
      issue.mastered = issue.mastered === true;
      issue.cooldownUntilConversation = Number.isInteger(issue.cooldownUntilConversation) ? issue.cooldownUntilConversation : 0;
      issue.reviewDueConversation = Number.isInteger(issue.reviewDueConversation) ? issue.reviewDueConversation : 0;
      issue.lastReviewedConversationId = typeof issue.lastReviewedConversationId === "string" ? issue.lastReviewedConversationId : "";
    }
    return progress;
  } catch {
    return fallback;
  }
}

function writeLearnerProgress(progress) {
  fs.writeFileSync(progressPath(), JSON.stringify(progress, null, 2), "utf8");
}

function issueIsEligible(issue, progress, conversation) {
  if (!issue) return false;
  if (issue.mastered) {
    return issue.reviewDueConversation <= progress.conversationSequence
      && issue.lastReviewedConversationId !== conversation.id;
  }
  return issue.cooldownUntilConversation <= progress.conversationSequence;
}

function choosePracticeTarget(progress, conversation) {
  const pending = progress.issues[conversation.pendingPracticeIssueId];
  if (issueIsEligible(pending, progress, conversation)) return pending;
  const issues = Object.values(progress.issues)
    .sort((a, b) => String(a.firstSeenAt).localeCompare(String(b.firstSeenAt)));
  return issues.find((issue) => issueIsEligible(issue, progress, conversation)) || null;
}

function learnerProgressView(progress, conversation = null) {
  return {
    conversationSequence: progress.conversationSequence,
    activePracticeIssueId: conversation && conversation.pendingPracticeIssueId
      ? conversation.pendingPracticeIssueId
      : "",
    issues: Object.values(progress.issues).map((issue) => ({
      id: issue.id,
      rule: issue.rule,
      original: issue.original,
      correction: issue.correction,
      explanation: issue.explanation,
      firstSeenAt: issue.firstSeenAt,
      mastered: issue.mastered,
      cycleAttempts: issue.cycleAttempts,
      totalAttempts: issue.totalAttempts,
      correctStreak: issue.correctStreak,
      cooldownUntilConversation: issue.cooldownUntilConversation,
      reviewDueConversation: issue.reviewDueConversation,
    })),
  };
}

function normalizeGrammarIssue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) return null;
  const fields = ["rule", "original", "correction", "explanation"];
  if (fields.some((key) => typeof value[key] !== "string" || !value[key].trim())) return null;
  return {
    id,
    rule: value.rule.trim().slice(0, 500),
    original: value.original.trim().slice(0, 1000),
    correction: value.correction.trim().slice(0, 1000),
    explanation: value.explanation.trim().slice(0, 1500),
  };
}

function saveGrammarIssue(progress, value) {
  const issue = normalizeGrammarIssue(value);
  if (!issue) return null;
  const now = new Date().toISOString();
  const existing = progress.issues[issue.id];
  if (existing) {
    Object.assign(existing, issue, { lastSeenAt: now });
    if (existing.mastered) {
      // A newly observed genuine error reopens a previously learned item.
      existing.mastered = false;
      existing.correctStreak = 0;
      existing.cycleAttempts = 0;
      existing.reviewDueConversation = 0;
      existing.cooldownUntilConversation = 0;
      existing.lastReviewedConversationId = "";
      delete existing.masteredAt;
    }
  } else {
    progress.issues[issue.id] = {
      ...issue,
      firstSeenAt: now,
      lastSeenAt: now,
      cycleAttempts: 0,
      totalAttempts: 0,
      correctStreak: 0,
      mastered: false,
      cooldownUntilConversation: 0,
      reviewDueConversation: 0,
      lastReviewedConversationId: "",
    };
  }
  return progress.issues[issue.id];
}

function applyPracticeResult(progress, result, conversation) {
  if (!result || result.tested !== true || typeof result.correct !== "boolean") return;
  const issueId = typeof result.issueId === "string" ? result.issueId : "";
  if (!issueId || issueId !== conversation.pendingPracticeIssueId) return;
  const issue = progress.issues[issueId];
  if (!issue || !issueIsEligible(issue, progress, conversation)) return;

  issue.totalAttempts += 1;
  issue.lastPracticedAt = new Date().toISOString();
  if (result.correct) {
    issue.correctStreak += 1;
    if (issue.mastered) {
      issue.lastReviewedConversationId = conversation.id;
      issue.reviewDueConversation = progress.conversationSequence + 4;
      return;
    }
    if (issue.correctStreak >= 3) {
      issue.mastered = true;
      issue.masteredAt = new Date().toISOString();
      issue.cooldownUntilConversation = 0;
      issue.reviewDueConversation = progress.conversationSequence + 3;
      issue.lastReviewedConversationId = "";
    }
    return;
  }

  issue.correctStreak = 0;
  if (issue.mastered) {
    issue.mastered = false;
    issue.cycleAttempts = 0;
    issue.reviewDueConversation = 0;
  }
  issue.cycleAttempts += 1;
  if (issue.cycleAttempts >= 10) {
    // Pause this item through the next three new conversations, then resume review.
    issue.cooldownUntilConversation = progress.conversationSequence + 4;
    issue.cycleAttempts = 0;
    issue.correctStreak = 0;
  }
}
function isSafeId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function conversationPath(id) {
  if (!isSafeId(id)) throw new Error("Invalid conversation id.");
  return path.join(conversationsDir(), id + ".json");
}

function readConversation(id) {
  try {
    const data = JSON.parse(fs.readFileSync(conversationPath(id), "utf8"));
    if (!data || !isSafeId(data.id)) return null;
    if (!Array.isArray(data.messages)) data.messages = [];
    if (typeof data.pendingPracticeIssueId !== "string") data.pendingPracticeIssueId = "";
    return data;
  } catch {
    return null;
  }
}

function writeConversation(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(conversationPath(data.id), JSON.stringify(data, null, 2), "utf8");
}

function summarize(data) {
  return {
    id: data.id,
    title: typeof data.title === "string" && data.title.trim() ? data.title : "مکالمه",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
  };
}

function createConversation() {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const now = new Date().toISOString();
  const progress = readLearnerProgress();
  progress.conversationSequence += 1;
  writeLearnerProgress(progress);
  const data = {
    id,
    title: "مکالمه جدید",
    createdAt: now,
    updatedAt: now,
    messages: [],
    pendingPracticeIssueId: "",
  };
  writeConversation(data);
  return data;
}

function parseTutorPayload(raw) {
  let text = typeof raw === "string" ? raw : raw && typeof raw.text === "string" ? raw.text : "";
  if (!text.trim()) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractConversationText(raw) {
  const parsed = parseTutorPayload(raw);
  if (parsed && typeof parsed.conversation === "string" && parsed.conversation.trim()) {
    return parsed.conversation.trim();
  }
  return typeof raw === "string" ? raw.trim() : raw && typeof raw.text === "string" ? raw.text.trim() : "";
}

function buildAgentInput(history, userText, progress, conversation, target) {
  const turns = history.map((message) =>
    (message.role === "user" ? "[User]: " : "[Tutor]: ") + message.text,
  );
  const historyBlock = turns.length
    ? "Previous conversation turns:\n" + turns.join("\n") + "\n\n"
    : "";
  const context = {
    conversationSequence: progress.conversationSequence,
    issues: Object.values(progress.issues),
    pendingPracticeIssueId: conversation.pendingPracticeIssueId || "",
    practiceTarget: target,
  };
  return historyBlock
    + "Learner grammar issues (JSON):\n"
    + JSON.stringify(context)
    + "\n\nNew user message:\n"
    + userText;
}

async function resolveTutorAgentId() {
  const agents = await extension.agents.list();
  const found = (agents || []).find((agent) => agent && agent.name === TUTOR_AGENT_NAME);
  if (!found) {
    throw new Error("The agent '" + TUTOR_AGENT_NAME + "' was not found. Save it in Mocu first.");
  }
  return found.id;
}

const extension = createExtension({
  commands: {
    // input: { audio: base64String, mimeType?: string }
    async transcribe(input) {
      const audio = input && typeof input.audio === "string" ? input.audio : "";
      if (!audio.trim()) throw new Error("No audio data was provided.");
      const mimeType = input && typeof input.mimeType === "string" && input.mimeType.trim()
        ? input.mimeType.trim()
        : undefined;
      const transcription = await extension.speech.transcribe(
        mimeType ? { audio, mimeType } : { audio },
      );
      return { text: transcription.text };
    },

    // input: {} — creates a fresh conversation file.
    async newConversation() {
      return summarize(createConversation());
    },

    // input: {} — conversation summaries, newest first.
    async listConversations() {
      const items = [];
      for (const name of fs.readdirSync(conversationsDir())) {
        if (!name.endsWith(".json")) continue;
        const data = readConversation(name.slice(0, -".json".length));
        if (data) items.push(summarize(data));
      }
      items.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      return { conversations: items };
    },

    // input: { id } — full conversation including messages.
    async getConversation(input) {
      const data = readConversation(input && input.id);
      if (!data) throw new Error("Conversation not found.");
      return data;
    },

    // input: { id }
    async deleteConversation(input) {
      try {
        fs.unlinkSync(conversationPath(input && input.id));
      } catch {
        // Already gone; treat as deleted.
      }
      return { deleted: true };
    },

    // input: {} — learner-wide issue and mastery status, across conversations.
    async getLearningProgress() {
      return { learnerProgress: learnerProgressView(readLearnerProgress()) };
    },

    // input: { text: string, conversationId?: string }
    async tutor(input) {
      const text = input && typeof input.text === "string" ? input.text : "";
      if (!text.trim()) throw new Error("Input text is empty.");

      const requestedId = input && typeof input.conversationId === "string" ? input.conversationId : "";
      let conversation = requestedId ? readConversation(requestedId) : null;
      if (!conversation) conversation = createConversation();
      if (typeof conversation.pendingPracticeIssueId !== "string") conversation.pendingPracticeIssueId = "";
      const isFirstTurn = conversation.messages.length === 0;

      const progress = readLearnerProgress();
      const target = choosePracticeTarget(progress, conversation);
      conversation.pendingPracticeIssueId = target ? target.id : "";
      const history = conversation.messages.slice(-MAX_HISTORY_TURNS);
      const agentId = await resolveTutorAgentId();
      const run = await extension.agents.run({
        agentId,
        input: buildAgentInput(history, text, progress, conversation, target),
      });
      const reply = run && typeof run.text === "string" ? run.text : "";
      const payload = parseTutorPayload(reply);

      conversation.messages.push({ role: "user", text: text.trim() });
      const tutorText = extractConversationText(reply);
      if (tutorText) conversation.messages.push({ role: "tutor", text: tutorText });
      if (isFirstTurn) conversation.title = text.trim().slice(0, 48);

      if (payload) {
        const detectedIssue = saveGrammarIssue(progress, payload.grammarIssue);
        applyPracticeResult(progress, payload.practiceResult, conversation);

        const nextId = (detectedIssue && detectedIssue.id) || payload.nextPracticeIssueId || "";
        const nextIssue = progress.issues[nextId];
        conversation.pendingPracticeIssueId = issueIsEligible(nextIssue, progress, conversation) ? nextId : "";
      }

      writeLearnerProgress(progress);
      writeConversation(conversation);
      return {
        reply,
        conversationId: conversation.id,
        learnerProgress: learnerProgressView(progress, conversation),
      };
    },

    // input: { text: string }
    async speak(input) {
      const text = input && typeof input.text === "string" ? input.text : "";
      if (!text.trim()) throw new Error("Input text is empty.");
      const speech = await extension.speech.speak({ text });
      return { audio: speech.audio, mimeType: speech.mimeType };
    },
  },
});

extension.start();
