/*
 * Plan Code Runner â€” Mocu extension.
 *
 * Reads an implementation-plan JSON file produced by a planner agent
 * (e.g. "Implementation Plan Architect"), executes its steps one at a
 * time through a coder agent, and accumulates every completed step's
 * work report so the next step runs with full context.
 *
 * When the coder reports a deviation or error (it had to change
 * something the plan did not anticipate), the extension sends the
 * deviation plus all work done so far to the planner agent, writes the
 * planner's updated plan back to the plan file, and re-runs the
 * affected step â€” repeating until the run finishes or a safety limit
 * is reached.
 */

import { createExtension } from "@mocu/extension-sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Defaults & limits
 * ------------------------------------------------------------------ */

const DEFAULT_CODER_NAME = "coder";
const DEFAULT_PLANNER_NAME = "Implementation Plan Architect";
const DEFAULT_MAX_STEPS = 40;
const DEFAULT_MAX_PLAN_UPDATES = 8;
const AGENT_TIMEOUT_MS = null; // no SDK-side timeout; command timeout governs

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const asPositiveInt = (value, fallback) => {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Pull the first parseable JSON object out of an agent's free-text
 * reply. Handles ```json fences and prose around the object.
 */
const extractJson = (text) => {
  if (typeof text !== "string") return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  candidates.push(text);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* try next candidate */
    }
  }
  return null;
};

/** Load and validate the plan file. Returns { plan, steps, error }. */
const loadPlan = (planPath) => {
  if (!planPath || typeof planPath !== "string") {
    return { error: "planPath must be a non-empty absolute file path." };
  }
  const abs = resolve(planPath.trim());
  if (!existsSync(abs)) {
    return { error: `Plan file not found: ${abs}` };
  }
  let plan;
  try {
    const raw = readFileSync(abs, "utf8").replace(/^\uFEFF/, ""); // strip BOM
    plan = JSON.parse(raw);
  } catch (err) {
    return { error: `Plan file is not valid JSON (${abs}): ${err.message}` };
  }
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.steps)) {
    return {
      error:
        "Plan file must be a JSON object with a `steps` array (each step needs at least a `step` and `title`/`goal`).",
    };
  }
  if (plan.steps.length === 0) {
    return { error: "Plan file contains no steps." };
  }
  for (const [i, s] of plan.steps.entries()) {
    if (!s || typeof s !== "object" || s.step === undefined) {
      return { error: `Plan step at index ${i} is missing its \`step\` number.` };
    }
  }
  return { plan, steps: plan.steps, path: abs };
};

/** Compact one completed step's report for the next prompt. */
const compactReport = (step, report) => {
  const title = step.title ?? step.goal ?? `step ${step.step}`;
  return [
    `### Step ${step.step}: ${title}`,
    typeof report === "string" ? report : JSON.stringify(report, null, 2),
  ].join("\n");
};

/* ------------------------------------------------------------------ *
 * Agent prompts
 * ------------------------------------------------------------------ */

const buildCoderPrompt = ({ step, plan, history, attempt }) => {
  const summaryBits = [];
  if (plan.project_summary) {
    summaryBits.push(
      `Plan project summary:\n${JSON.stringify(plan.project_summary, null, 2)}`,
    );
  }
  if (Array.isArray(plan.overall_acceptance_criteria) && plan.overall_acceptance_criteria.length) {
    summaryBits.push(
      `Plan acceptance criteria:\n- ${plan.overall_acceptance_criteria.join("\n- ")}`,
    );
  }

  const historyBlock = history.length
    ? `Completed steps and their work reports (treat as done, do not redo):\n\n${history.join("\n\n")}`
    : "No steps have been completed yet; this is the first step.";

  const retryNote =
    attempt > 1
      ? "\nIMPORTANT: your previous reply could not be parsed. Respond with ONLY a single valid JSON object, no prose, no markdown fences.\n"
      : "";

  return `You are the coding agent executing ONE step of an implementation plan.

${summaryBits.join("\n\n") || "No plan summary available."}

${historyBlock}

CURRENT STEP TO EXECUTE:
${JSON.stringify(step, null, 2)}

${retryNote}
Do the work for this step using your tools, then reply with ONLY one valid JSON object:

{
  "status": "success" | "deviation",
  "report": {
    "summary": "what you did",
    "files_created": ["..."],
    "files_modified": [{"path": "...", "change": "..."}],
    "outputs": ["key results, commands run, tests, artifacts"],
    "issues": ["anything left open"]
  },
  "deviation": {
    "present": true|false,
    "reason": "why this step could not be done as planned",
    "forced_changes": ["what you had to change or invent that the plan did not contain"],
    "work_already_done": ["what you did before hitting the problem"]
  }
}

Rules:
- "status" must be "success" only when the step completed as written in the plan.
- If you had to change, add, or skip anything the plan did not anticipate (including the plan being wrong or impossible as written), use "status": "deviation", fill "deviation" honestly, and still describe all work you actually completed in "report".
- Be precise about files created and modified â€” the next step and the planner rely on this report.`;
};

const buildPlannerPrompt = ({ planText, history, deviation, failedStep }) => {
  const historyBlock = history.length
    ? `Completed work reports so far:\n\n${history.join("\n\n")}`
    : "No steps were completed before this point.";

  return `You are the implementation planning agent. The plan below is being executed step by step by a coder agent. The current step failed or deviated: the coder could not follow the plan as written and had to change things the plan did not contain.

PLAN FILE (current):
${planText}

FAILED / DEVIATED STEP:
${JSON.stringify(failedStep, null, 2)}

${historyBlock}

CODER REPORT ON THE DEVIATION:
${JSON.stringify(deviation, null, 2)}

Update the plan so it stays correct and executable given everything that actually happened: incorporate the forced changes the coder made, keep completed work as done, renumber/reorder steps as needed, and make the failed step (or its replacement) executable next.

Reply with ONLY the complete updated plan as one valid JSON object. It must keep the same overall structure (project_summary, assumptions, steps array, overall_acceptance_criteria) and every step must still carry step/goal/actions/dependencies/files_to_create/files_to_modify/expected_result/verification/handoff_notes fields. Do not drop fields, do not add commentary outside the JSON.`;
};

/* ------------------------------------------------------------------ *
 * Extension
 * ------------------------------------------------------------------ */

const extension = createExtension({
  commands: {
    /* --- preview: read a plan file without executing -------------- */
    async preview_plan(input) {
      const planPath =
        typeof input === "string"
          ? input
          : (input && typeof input === "object" && input.planPath) || "";
      const loaded = loadPlan(planPath);
      if (loaded.error) return { ok: false, error: loaded.error };

      return {
        ok: true,
        planPath: loaded.path,
        stepCount: loaded.steps.length,
        steps: loaded.steps.map((s) => ({
          step: s.step,
          title: s.title ?? null,
          goal: s.goal ?? null,
        })),
      };
    },

    /* --- run_plan: the full planner <-> coder loop ---------------- */
    async run_plan(input, context, config) {
      /* ---- progress notifications into the chat tool card ---- */
      let flushTimer = null;
      let buffer = "";
      const notify = (text) => {
        buffer += text;
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          const chunk = buffer;
          buffer = "";
          flushTimer = null;
          extension.notify("mocu.extension.activity", {
            toolCallId: context?.toolCallId,
            toolName: context?.toolName,
            text: chunk,
          });
        }, 300);
      };
      const flush = () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (buffer) {
          extension.notify("mocu.extension.activity", {
            toolCallId: context?.toolCallId,
            toolName: context?.toolName,
            text: buffer,
          });
          buffer = "";
        }
      };

      /* ---- normalize input (object or plain path string) ---- */
      const params =
        input && typeof input === "object" && !Array.isArray(input) ? input : {};
      const planPath =
        typeof input === "string"
          ? input
          : String(params.planPath ?? "").trim();
      const coderName = String(params.coderAgentName ?? DEFAULT_CODER_NAME).trim();
      const plannerName = String(
        params.plannerAgentName ?? DEFAULT_PLANNER_NAME,
      ).trim();
      const startStep = asPositiveInt(params.startStep, 1);
      const maxSteps = asPositiveInt(params.maxSteps, DEFAULT_MAX_STEPS);
      const maxPlanUpdates = asPositiveInt(
        params.maxPlanUpdates,
        DEFAULT_MAX_PLAN_UPDATES,
      );

      const finish = (payload) => {
        flush();
        return payload;
      };

      /* ---- load plan file ---- */
      const loaded = loadPlan(planPath);
      if (loaded.error) {
        notify(`Plan load failed: ${loaded.error}\n`);
        return finish({ status: "error", stage: "load_plan", error: loaded.error });
      }
      let plan = loaded.plan;
      let steps = loaded.steps;
      let planPathAbs = loaded.path;
      notify(
        `Loaded plan: ${planPathAbs}\n${steps.length} step(s) in plan.\n`,
      );

      /* ---- resolve agents ---- */
      let agents;
      try {
        agents = await extension.agents.list();
      } catch (err) {
        return finish({
          status: "error",
          stage: "list_agents",
          error: `Could not list agents (is "agents.invoke" declared?): ${err.message}`,
        });
      }
      const findAgent = (name) =>
        agents.find((a) => a.name === name) ??
        agents.find((a) => a.name.toLowerCase() === name.toLowerCase());

      const coder = findAgent(coderName);
      if (!coder) {
        return finish({
          status: "error",
          stage: "find_coder",
          error: `Coder agent "${coderName}" not found. Saved agents: ${agents
            .map((a) => a.name)
            .join(", ")}`,
        });
      }
      const planner = findAgent(plannerName);
      if (!planner) {
        return finish({
          status: "error",
          stage: "find_planner",
          error: `Planner agent "${plannerName}" not found. Saved agents: ${agents
            .map((a) => a.name)
            .join(", ")}`,
        });
      }
      notify(`Coder: ${coder.name} | Planner: ${planner.name}\n`);

      /* ---- run state ---- */
      const stepHistory = []; // compact reports of completed steps
      const stepReports = []; // full report records for the run result
      const planRevisions = []; // every planner-driven plan update
      let planUpdates = 0;
      let executedCount = 0;
      let idx = steps.findIndex((s) => Number(s.step) >= startStep);
      if (idx === -1) idx = 0;

      const runCoder = async (step, attempt) => {
        const prompt = buildCoderPrompt({ step, plan, history: stepHistory, attempt });
        const result = await extension.agents.run(
          { agentId: coder.id, input: prompt },
          { timeoutMs: AGENT_TIMEOUT_MS },
        );
        return result.text ?? "";
      };

      /* ---- main loop ---- */
      while (idx < steps.length) {
        if (executedCount >= maxSteps) {
          notify(`Stopped: maxSteps (${maxSteps}) reached.\n`);
          return finish({
            status: "stopped_limit",
            reason: `maxSteps (${maxSteps}) reached at plan step ${steps[idx]?.step}.`,
            planPath: planPathAbs,
            currentIndex: idx,
            completed: stepReports,
            planRevisions,
          });
        }

        const step = steps[idx];
        const stepLabel = `Step ${step.step}${step.title ? `: ${step.title}` : ""}`;

        notify(`\n>>> ${stepLabel}\nSending step to coder (${coder.name})...\n`);
        executedCount += 1;

        /* coder attempt (with one retry on unparseable output) */
        let parsed = null;
        let rawText = "";
        for (let attempt = 1; attempt <= 2 && !parsed; attempt += 1) {
          rawText = await runCoder(step, attempt);
          parsed = extractJson(rawText);
          if (!parsed && attempt === 1) {
            notify("Coder reply was not valid JSON; retrying once...\n");
          }
        }

        if (!parsed) {
          /* coder never produced a structured answer -> treat as error
             and hand it to the planner as a deviation so the plan can be
             adjusted (or clarified) before the next attempt. */
          const deviation = {
            present: true,
            reason: "Coder did not return a parseable JSON report after a retry.",
            forced_changes: [],
            work_already_done: [],
            raw_coder_output: rawText.slice(0, 8000),
          };
          parsed = { status: "deviation", report: { summary: rawText.slice(0, 2000) }, deviation };
        }

        const isDeviation = parsed.status !== "success";

        if (!isDeviation) {
          const report = parsed.report ?? { summary: "No report returned." };
          stepReports.push({ step: step.step, title: step.title ?? null, report });
          stepHistory.push(compactReport(step, report));
          const files = [
            ...(Array.isArray(report.files_created) ? report.files_created : []),
            ...(Array.isArray(report.files_modified)
              ? report.files_modified.map((f) =>
                  typeof f === "string" ? f : (f?.path ?? ""),
                )
              : []),
          ].filter(Boolean);
          notify(
            `<<< Step ${step.step} completed successfully.` +
              (files.length ? ` Files: ${files.join(", ")}` : "") +
              `\n`,
          );
          idx += 1;
          continue;
        }

        /* ---- deviation: planner updates the plan ---- */
        const deviation = parsed.deviation ?? {
          present: true,
          reason: String(parsed.report?.summary ?? "Unspecified deviation."),
          forced_changes: [],
          work_already_done: [],
        };

        /* keep whatever work actually happened in the history either way */
        if (parsed.report) {
          stepHistory.push(
            compactReport(step, {
              ...parsed.report,
              note: "This step ended in deviation; treat its partial work as done.",
            }),
          );
        }

        notify(
          `<<< Step ${step.step} DEVIATION: ${deviation.reason ?? "unspecified"}\n` +
            `Sending deviation + completed work to planner (${planner.name}) for a plan update...\n`,
        );

        if (planUpdates >= maxPlanUpdates) {
          stepReports.push({
            step: step.step,
            title: step.title ?? null,
            status: "deviation",
            deviation,
            unresolved: true,
          });
          return finish({
            status: "error",
            stage: "max_plan_updates",
            reason: `Planner was asked ${maxPlanUpdates} time(s) to update the plan; limit reached with the step still failing.`,
            planPath: planPathAbs,
            lastDeviation: deviation,
            completed: stepReports,
            planRevisions,
          });
        }

        const planText = JSON.stringify(plan, null, 2);
        const plannerReply = await extension.agents.run(
          {
            agentId: planner.id,
            input: buildPlannerPrompt({
              planText,
              history: stepHistory,
              deviation,
              failedStep: step,
            }),
          },
          { timeoutMs: AGENT_TIMEOUT_MS },
        );

        const updatedPlan = extractJson(plannerReply.text ?? "");
        if (!updatedPlan || !Array.isArray(updatedPlan.steps)) {
          stepReports.push({
            step: step.step,
            title: step.title ?? null,
            status: "deviation",
            deviation,
            unresolved: true,
            plannerError: "Planner did not return a valid updated plan JSON.",
          });
          return finish({
            status: "error",
            stage: "plan_update",
            error: "Planner did not return a valid updated plan JSON.",
            plannerReply: (plannerReply.text ?? "").slice(0, 4000),
            planPath: planPathAbs,
            completed: stepReports,
            planRevisions,
          });
        }

        /* backup the previous plan, then overwrite it */
        planUpdates += 1;
        const backupPath = `${planPathAbs}.backup-${planUpdates}`;
        try {
          writeFileSync(backupPath, planText, "utf8");
          writeFileSync(planPathAbs, JSON.stringify(updatedPlan, null, 2), "utf8");
        } catch (err) {
          return finish({
            status: "error",
            stage: "write_plan",
            error: `Could not write updated plan back to ${planPathAbs}: ${err.message}`,
            completed: stepReports,
            planRevisions,
          });
        }

        /* re-validate from disk so we run exactly what was saved */
        const reloaded = loadPlan(planPathAbs);
        if (reloaded.error) {
          return finish({
            status: "error",
            stage: "reload_plan",
            error: `Updated plan failed validation: ${reloaded.error}`,
            completed: stepReports,
            planRevisions,
          });
        }
        plan = reloaded.plan;
        steps = reloaded.steps;

        planRevisions.push({
          revision: planUpdates,
          backupPath,
          reason: deviation.reason ?? "deviation",
          forcedChanges: deviation.forced_changes ?? [],
          stepCount: steps.length,
        });

        notify(
          `Plan updated and saved (rev ${planUpdates}, backup: ${backupPath}). Re-running step ${step.step} against the updated plan...\n`,
        );

        /* resume at the updated counterpart of the failed step */
        let resume = steps.findIndex((s) => Number(s.step) === Number(step.step));
        if (resume === -1) resume = Math.min(idx, steps.length - 1);
        if (resume < 0) resume = 0;
        idx = resume;
        /* do not increment executedCount here: this retry is caused by the
           plan update, not by forward progress. Remove the retry from the
           budget by not counting it twice. */
        executedCount -= 1;
      }

      notify(`\n=== Plan finished: all ${steps.length} step(s) executed. ===\n`);
      return finish({
        status: "completed",
        planPath: planPathAbs,
        executedSteps: executedCount,
        planUpdates,
        completed: stepReports,
        planRevisions,
      });
    },
  },
});

extension.start();