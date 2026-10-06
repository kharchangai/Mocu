/* Plan Code Runner: execute and resume bounded JSON implementation plans. */
import { createExtension } from "@mocu/extension-sdk";
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const DEFAULT_CODER = "coder";
const DEFAULT_REVISER = "Implementation Plan Reviser";
const DEFAULT_MAX_STEPS = 20;
const MAX_STEPS = 40;
const DEFAULT_MAX_UPDATES = 2;
const MAX_UPDATES = 4;
const CODER_TIMEOUT = 600000;
const REVISER_TIMEOUT = 180000;
const MAX_TIMEOUT = 1800000;
const STATE_VERSION = 1;
const statePathFor = (path) => `${path}.run-state.json`;
const positiveInt = (value, fallback, max) => {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const stringArray = (x) => Array.isArray(x) && x.every((v) => typeof v === "string");
const planHash = (plan) => createHash("sha256").update(JSON.stringify(plan)).digest("hex");

const validatePlan = (plan) => {
  if (!isObject(plan) || !Array.isArray(plan.steps) || plan.steps.length === 0) return "Plan must contain a non-empty steps array.";
  let last = 0;
  for (const [i, step] of plan.steps.entries()) {
    if (!isObject(step) || !Number.isSafeInteger(step.step) || step.step <= last) return `Step ${i + 1} must have a unique increasing positive integer number.`;
    last = step.step;
  }
  return null;
};
const validateReport = (x) => {
  if (!isObject(x) || !["success", "deviation"].includes(x.status)) return "status must be success or deviation.";
  if (!["completed", "incomplete"].includes(x.stepOutcome)) return "stepOutcome must be completed or incomplete.";
  const r = x.report;
  if (!isObject(r) || typeof r.summary !== "string" || !stringArray(r.files_created) || !stringArray(r.files_modified) || !stringArray(r.outputs) || !stringArray(r.issues)) return "report fields are invalid.";
  if (x.status === "success" && x.stepOutcome !== "completed") return "success requires completed outcome.";
  if (x.status === "deviation") {
    const d = x.deviation;
    if (!isObject(d) || typeof d.reason !== "string" || !stringArray(d.forced_changes) || !stringArray(d.work_already_done)) return "deviation fields are invalid.";
  }
  return null;
};
const validateState = (state, planPath, plan) => {
  if (!isObject(state) || state.version !== STATE_VERSION || state.planPath !== planPath) return "Checkpoint path/version mismatch.";
  if (!Array.isArray(state.completed) || !Array.isArray(state.history) || !Array.isArray(state.planRevisions)) return "Checkpoint progress arrays are invalid.";
  if (!Number.isSafeInteger(state.nextIndex) || state.nextIndex < 0 || state.nextIndex > plan.steps.length) return "Checkpoint nextIndex is invalid.";
  if (!Number.isSafeInteger(state.executedSteps) || state.executedSteps < 0 || !Number.isSafeInteger(state.planUpdates) || state.planUpdates < 0) return "Checkpoint counters are invalid.";
  if (state.planHash !== planHash(plan)) return "Plan changed since checkpoint; refusing stale resume.";
  if (state.inProgressStep != null && !plan.steps.some((s) => s.step === state.inProgressStep)) return "Checkpoint in-progress step is absent from plan.";
  if (state.completed.some((x) => !isObject(x) || !Number.isSafeInteger(x.step) || !plan.steps.some((s) => s.step === x.step))) return "Checkpoint completed-step record is invalid.";
  if (state.pendingDeviation != null && (!isObject(state.pendingDeviation) || !Number.isSafeInteger(state.pendingDeviation.step))) return "Checkpoint pending deviation is invalid.";
  return null;
};
const saveState = (file, state) => {
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  renameSync(temp, file);
};
const readState = (file, path, plan) => {
  if (!existsSync(file)) return { error: `No checkpoint exists for ${path}.` };
  let state;
  try { state = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch (e) { return { error: `Checkpoint JSON invalid: ${e.message}` }; }
  const error = validateState(state, path, plan);
  return error ? { error } : { state };
};
const loadPlan = (path) => {
  if (typeof path !== "string" || !path.trim()) return { error: "planPath is required." };
  const abs = resolve(path.trim());
  if (!existsSync(abs)) return { error: `Plan not found: ${abs}` };
  let plan;
  try { plan = JSON.parse(readFileSync(abs, "utf8").replace(/^\uFEFF/, "")); }
  catch (e) { return { error: `Invalid plan JSON: ${e.message}` }; }
  const error = validatePlan(plan);
  return error ? { error } : { path: abs, plan, steps: plan.steps };
};
const extractJson = (text) => {
  if (typeof text !== "string") return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  const first = text.indexOf("{"); const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  candidates.push(text);
  for (const candidate of candidates) {
    try { const parsed = JSON.parse(candidate.trim()); if (isObject(parsed)) return parsed; } catch { /* try next */ }
  }
  return null;
};
const bounded = (x, max) => {
  const text = typeof x === "string" ? x : JSON.stringify(x, null, 2);
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated]`;
};
const reportText = (step, report) => `### Step ${step.step}: ${step.title ?? step.goal ?? step.step}\n${bounded(report, 4000)}`;
const coderPrompt = ({ step, plan, history, retry, recovery }) => {
  const context = [];
  if (plan.project_summary) context.push(`Project summary:\n${bounded(plan.project_summary, 2500)}`);
  if (Array.isArray(plan.overall_acceptance_criteria)) context.push(`Acceptance criteria:\n- ${plan.overall_acceptance_criteria.slice(0, 16).join("\n- ")}`);
  const recover = recovery ? "RECOVERY: this step was in progress when execution stopped. Inspect only relevant current files, compare against expected_result, and perform only remaining work; do not blindly repeat non-idempotent actions." : "";
  const previous = history.length ? `Earlier reports (completed work is done; do not redo):\n${history.slice(-5).join("\n\n")}` : "No earlier steps completed.";
  return `Execute ONLY the current plan step. Make minimal in-scope changes; preserve unrelated code; run focused checks only; report honestly.\n\n${recover}\n\n${context.join("\n\n")}\n\n${previous}\n\nCURRENT STEP:\n${JSON.stringify(step, null, 2)}\n\n${retry ? "Previous response had invalid JSON schema. Return corrected JSON only; do not repeat work.\n" : ""}Return one JSON object: status success|deviation, stepOutcome completed|incomplete, report {summary,files_created[],files_modified[],outputs[],issues[]}, and on deviation deviation {reason,forced_changes[],work_already_done[]}. Success requires completed and omits deviation. Deviation is completed only if intended result was achieved.`;
};
const reviserPrompt = ({ plan, history, step, outcome, deviation }) => {
  const rule = outcome === "completed" ? "Intended result achieved: preserve this and earlier steps unchanged; revise only later steps." : "Affected step incomplete or uncertain: preserve earlier completed steps and revise the affected step for another attempt; never infer completion from partial work.";
  return `Revise only as needed from the supplied evidence. Do no project work; invent no facts.\n\nPLAN:\n${JSON.stringify(plan, null, 2)}\n\nAFFECTED STEP:\n${JSON.stringify(step, null, 2)}\nOUTCOME: ${outcome}\nHISTORY:\n${history.slice(-6).join("\n\n")}\nDEVIATION:\n${bounded(deviation, 4000)}\n\n${rule} Preserve unaffected metadata and steps, keep the same step schema and unique increasing numbers. Return only the complete valid JSON plan.`;
};

const extension = createExtension({
  commands: {
    async preview_plan(input) {
      const loaded = loadPlan(typeof input === "string" ? input : input?.planPath ?? "");
      if (loaded.error) return { ok: false, error: loaded.error };
      const stateFile = statePathFor(loaded.path);
      const saved = existsSync(stateFile) ? readState(stateFile, loaded.path, loaded.plan) : null;
      return { ok: true, planPath: loaded.path, stepCount: loaded.steps.length, runStatePath: stateFile,
        resumeAvailable: Boolean(saved?.state && saved.state.status !== "completed"),
        steps: loaded.steps.map((s) => ({ step: s.step, title: s.title ?? null, goal: s.goal ?? s.actions ?? null })) };
    },
    async run_plan(input, context) { return executePlan(input, context, false); },
    async resume_plan(input, context) { return executePlan(input, context, true); },
  },
});

async function executePlan(input, context, isResume) {
  let activity = ""; let timer = null;
  const notify = (text) => {
    activity += text;
    if (!timer) timer = setTimeout(() => {
      const chunk = activity; activity = ""; timer = null;
      extension.notify("mocu.extension.activity", { toolCallId: context?.toolCallId, toolName: context?.toolName, text: chunk });
    }, 300);
  };
  const finish = (value) => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (activity) extension.notify("mocu.extension.activity", { toolCallId: context?.toolCallId, toolName: context?.toolName, text: activity });
    activity = ""; return value;
  };
  const args = isObject(input) ? input : {};
  const rawPath = typeof input === "string" ? input : String(args.planPath ?? "").trim();
  const loaded = loadPlan(rawPath);
  if (loaded.error) return finish({ status: "error", stage: "load_plan", error: loaded.error });
  const planPath = loaded.path; const stateFile = statePathFor(planPath);
  let plan = loaded.plan; let steps = loaded.steps; let state;
  const coderName = String(args.coderAgentName ?? DEFAULT_CODER).trim();
  const reviserName = String(args.reviserAgentName ?? DEFAULT_REVISER).trim();
  const maxSteps = positiveInt(args.maxSteps, DEFAULT_MAX_STEPS, MAX_STEPS);
  const maxUpdates = positiveInt(args.maxPlanUpdates, DEFAULT_MAX_UPDATES, MAX_UPDATES);
  const coderTimeout = positiveInt(args.coderTimeoutMs, CODER_TIMEOUT, MAX_TIMEOUT);
  const reviserTimeout = positiveInt(args.reviserTimeoutMs, REVISER_TIMEOUT, MAX_TIMEOUT);

  if (isResume) {
    const saved = readState(stateFile, planPath, plan);
    if (saved.error) return finish({ status: "error", stage: "resume_state", error: saved.error, runStatePath: stateFile });
    state = saved.state;
    if (state.status === "completed") return finish({ status: "error", stage: "resume_state", error: "This run is complete; use run_plan with startNew:true for a new run.", runStatePath: stateFile });
    notify(`Resuming saved run; ${state.completed.length} completed step(s).\n`);
  } else {
    if (existsSync(stateFile)) {
      if (args.startNew === true) {
        try { renameSync(stateFile, `${stateFile}.archived-${Date.now()}`); }
        catch (e) { return finish({ status: "error", stage: "archive_state", error: e.message, runStatePath: stateFile }); }
      } else {
        const saved = readState(stateFile, planPath, plan);
        if (saved.error) return finish({ status: "error", stage: "existing_run", error: `${saved.error} Use startNew:true only for an intentional restart.`, runStatePath: stateFile });
        if (saved.state.status !== "completed") return finish({ status: "error", stage: "existing_run", error: `Unfinished run exists. Use resume_plan: ${stateFile}`, runStatePath: stateFile });
      }
    }
    const firstStep = positiveInt(args.startStep, 1, MAX_STEPS);
    const startIndex = steps.findIndex((s) => s.step >= firstStep);
    if (startIndex < 0) return finish({ status: "error", stage: "start_step", error: `No step >= ${firstStep}.` });
    state = { version: STATE_VERSION, planPath, planHash: planHash(plan), status: "running", nextIndex: startIndex,
      inProgressStep: null, pendingDeviation: null, completed: [], history: [], planRevisions: [], planUpdates: 0,
      executedSteps: 0, lastError: null, createdAt: new Date().toISOString() };
    try { saveState(stateFile, state); }
    catch (e) { return finish({ status: "error", stage: "save_state", error: e.message, runStatePath: stateFile }); }
  }

  const pause = (reason, extra = {}) => {
    state.status = "paused"; state.lastError = reason;
    try { saveState(stateFile, state); }
    catch (e) { return finish({ status: "error", stage: "save_state", error: `${reason}; could not save checkpoint: ${e.message}`, runStatePath: stateFile }); }
    return finish({ status: "paused", reason, planPath, runStatePath: stateFile,
      currentStep: state.pendingDeviation?.step ?? state.inProgressStep ?? steps[state.nextIndex]?.step ?? null,
      completed: state.completed, planRevisions: state.planRevisions, ...extra });
  };
  let agents;
  try { agents = await extension.agents.list(); }
  catch (e) { return pause(`Could not list agents: ${e.message}`, { stage: "list_agents" }); }
  const findAgent = (name) => agents.find((a) => a.name === name) ?? agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
  const coder = findAgent(coderName); const reviser = findAgent(reviserName);
  if (!coder) return pause(`Coder '${coderName}' not found.`, { stage: "find_coder" });
  if (!reviser) return pause(`Reviser '${reviserName}' not found.`, { stage: "find_reviser" });

  let index = state.pendingDeviation ? steps.findIndex((s) => s.step === state.pendingDeviation.step)
    : state.inProgressStep != null ? steps.findIndex((s) => s.step === state.inProgressStep) : state.nextIndex;
  if (index < 0 || index >= steps.length) {
    if (state.nextIndex === steps.length && state.inProgressStep == null && !state.pendingDeviation) {
      state.status = "completed";
      try { saveState(stateFile, state); } catch (e) { return finish({ status: "error", stage: "save_state", error: e.message, runStatePath: stateFile }); }
      return finish({ status: "completed", planPath, runStatePath: stateFile, completed: state.completed, planRevisions: state.planRevisions });
    }
    return pause("Checkpoint does not match the plan.", { stage: "resume_state" });
  }

  let executedThisCall = 0;
  const revisePending = async () => {
    const pending = state.pendingDeviation;
    const step = steps.find((s) => s.step === pending?.step);
    if (!step) return pause("Pending deviation step missing from plan.", { stage: "resume_state" });
    if (state.planUpdates >= maxUpdates) return pause(`Plan update limit (${maxUpdates}) reached.`, { stage: "max_plan_updates" });
    let response;
    try { response = await extension.agents.run({ agentId: reviser.id, input: reviserPrompt({ plan, history: state.history, step, outcome: pending.outcome, deviation: pending.deviation }) }, { timeoutMs: reviserTimeout }); }
    catch (e) { return pause(`Plan reviser invocation failed: ${e.message}`, { stage: "plan_update" }); }
    const revised = extractJson(response.text ?? "");
    const issue = validatePlan(revised);
    if (issue) return pause(`Reviser returned invalid plan: ${issue}`, { stage: "plan_update", reviserReply: bounded(response.text ?? "", 3000) });
    const original = JSON.stringify(plan, null, 2);
    const backup = `${planPath}.backup-${state.planUpdates + 1}`;
    try { writeFileSync(backup, original, "utf8"); writeFileSync(planPath, JSON.stringify(revised, null, 2), "utf8"); }
    catch (e) { return pause(`Could not save revised plan: ${e.message}`, { stage: "write_plan" }); }
    const reloaded = loadPlan(planPath);
    if (reloaded.error) {
      try { writeFileSync(planPath, original, "utf8"); } catch { /* best effort */ }
      return pause(`Revised plan invalid; original restore attempted: ${reloaded.error}`, { stage: "reload_plan" });
    }
    plan = reloaded.plan; steps = reloaded.steps; state.planHash = planHash(plan); state.planUpdates += 1;
    state.planRevisions.push({ revision: state.planUpdates, backupPath: backup, reason: pending.deviation.reason, stepOutcome: pending.outcome });
    const current = steps.findIndex((s) => s.step === pending.step);
    index = pending.outcome === "completed" ? (current >= 0 ? current + 1 : steps.findIndex((s) => s.step > pending.step)) : (current >= 0 ? current : steps.findIndex((s) => s.step >= pending.step));
    if (index < 0) index = steps.length;
    state.completed.push({ step: pending.step, status: "deviation", stepOutcome: pending.outcome, report: pending.report, deviation: pending.deviation, revisedPlan: true });
    state.pendingDeviation = null; state.inProgressStep = null; state.nextIndex = index; state.status = index >= steps.length ? "completed" : "running";
    try { saveState(stateFile, state); }
    catch (e) { state.pendingDeviation = pending; return pause(`Plan revised but checkpoint save failed: ${e.message}`, { stage: "save_checkpoint" }); }
    return null;
  };

  while (index < steps.length || state.pendingDeviation) {
    if (state.pendingDeviation) {
      const stopped = await revisePending();
      if (stopped) return stopped;
      index = state.nextIndex;
      continue;
    }
    if (executedThisCall >= maxSteps && !(isResume && state.inProgressStep != null && state.inProgressStep === steps[index]?.step && executedThisCall === 0)) {
      state.status = "paused"; state.nextIndex = index; state.inProgressStep = null;
      try { saveState(stateFile, state); } catch (e) { return finish({ status: "error", stage: "save_state", error: e.message, runStatePath: stateFile }); }
      return finish({ status: "paused", reason: `maxSteps (${maxSteps}) reached; use resume_plan.`, planPath, runStatePath: stateFile, currentStep: steps[index]?.step, completed: state.completed, planRevisions: state.planRevisions });
    }
    const step = steps[index];
    const recovering = isResume && state.inProgressStep === step.step;
    state.status = "running"; state.nextIndex = index; state.inProgressStep = step.step; state.lastError = null;
    state.executedSteps += 1; executedThisCall += 1;
    try { saveState(stateFile, state); }
    catch (e) { return finish({ status: "error", stage: "save_checkpoint", error: e.message, runStatePath: stateFile }); }
    notify(`\n>>> Step ${step.step}${step.title ? `: ${step.title}` : ""}\n`);
    let result = null; let raw = ""; let schemaError = "";
    for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
      try {
        const reply = await extension.agents.run({ agentId: coder.id, input: coderPrompt({ step, plan, history: state.history, retry: attempt === 1, recovery: recovering }) }, { timeoutMs: coderTimeout });
        raw = reply.text ?? "";
      } catch (e) { return pause(`Coder invocation failed: ${e.message}`, { stage: "coder", currentStep: step.step }); }
      const candidate = extractJson(raw);
      schemaError = validateReport(candidate) ?? "";
      if (!schemaError) result = candidate;
      else if (attempt === 0) notify(`Invalid coder report (${schemaError}); one format retry requested.\n`);
    }
    if (!result) {
      const reason = `Invalid coder report after one format retry: ${schemaError || "unparseable JSON"}`;
      result = { status: "deviation", stepOutcome: "incomplete", report: { summary: bounded(raw, 1500), files_created: [], files_modified: [], outputs: [], issues: [reason] }, deviation: { reason, forced_changes: [], work_already_done: [] } };
    }
    if (result.status === "success") {
      state.completed.push({ step: step.step, title: step.title ?? null, report: result.report });
      state.history.push(reportText(step, result.report));
      index += 1; state.nextIndex = index; state.inProgressStep = null;
      try { saveState(stateFile, state); }
      catch (e) { state.inProgressStep = step.step; return pause(`Step completed but checkpoint failed: ${e.message}`, { stage: "save_checkpoint" }); }
      notify(`<<< Step ${step.step} completed and checkpointed.\n`);
      continue;
    }
    const pending = { step: step.step, outcome: result.stepOutcome, report: result.report, deviation: result.deviation };
    state.history.push(reportText(step, { ...result.report, stepOutcome: result.stepOutcome }));
    state.pendingDeviation = pending; state.inProgressStep = step.step; state.nextIndex = index; state.status = "paused"; state.lastError = result.deviation.reason;
    try { saveState(stateFile, state); }
    catch (e) { return finish({ status: "error", stage: "save_state", error: `Deviation checkpoint failed: ${e.message}`, runStatePath: stateFile }); }
    const stopped = await revisePending();
    if (stopped) return stopped;
    index = state.nextIndex;
  }
  state.status = "completed"; state.nextIndex = steps.length; state.inProgressStep = null;
  try { saveState(stateFile, state); }
  catch (e) { return finish({ status: "error", stage: "save_state", error: e.message, runStatePath: stateFile }); }
  return finish({ status: "completed", planPath, runStatePath: stateFile, executedSteps: state.executedSteps, planUpdates: state.planUpdates, completed: state.completed, planRevisions: state.planRevisions });
}

extension.start();
