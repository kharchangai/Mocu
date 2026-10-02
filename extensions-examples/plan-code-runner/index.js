/*
 * Plan Code Runner — Mocu extension.
 *
 * Reads a JSON implementation plan, executes each step through the coder
 * agent, and carries execution reports forward as context. On deviation,
 * it asks Implementation Plan Reviser to replan only from the affected
 * step onward. If the affected step's intended result was achieved,
 * execution resumes at the next step; otherwise that revised step is retried.
 */

import { createExtension } from "@mocu/extension-sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_CODER_NAME = "coder";
const DEFAULT_PLANNER_NAME = "Implementation Plan Reviser";
const DEFAULT_MAX_STEPS = 40;
const DEFAULT_MAX_PLAN_UPDATES = 8;
const AGENT_TIMEOUT_MS = null;

const asPositiveInt = (value, fallback) => {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Extract the first parseable JSON object from an agent reply. */
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
      // Try the next candidate.
    }
  }
  return null;
};

/** Load and minimally validate the implementation-plan JSON file. */
const loadPlan = (planPath) => {
  if (!planPath || typeof planPath !== "string") {
    return { error: "planPath must be a non-empty absolute file path." };
  }
  const abs = resolve(planPath.trim());
  if (!existsSync(abs)) return { error: `Plan file not found: ${abs}` };
  let plan;
  try {
    const raw = readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
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
  if (plan.steps.length === 0) return { error: "Plan file contains no steps." };
  for (const [i, step] of plan.steps.entries()) {
    if (!step || typeof step !== "object" || step.step === undefined) {
      return { error: `Plan step at index ${i} is missing its step number.` };
    }
  }
  return { plan, steps: plan.steps, path: abs };
};

const compactReport = (step, report) => {
  const title = step.title ?? step.goal ?? `step ${step.step}`;
  return [
    `### Step ${step.step}: ${title}`,
    typeof report === "string" ? report : JSON.stringify(report, null, 2),
  ].join("\n");
};

const buildCoderPrompt = ({ step, plan, history, attempt }) => {
  const summaryBits = [];
  if (plan.project_summary) {
    summaryBits.push(
      `Plan project summary:\n${JSON.stringify(plan.project_summary, null, 2)}`,
    );
  }
  if (
    Array.isArray(plan.overall_acceptance_criteria) &&
    plan.overall_acceptance_criteria.length
  ) {
    summaryBits.push(
      `Plan acceptance criteria:\n- ${plan.overall_acceptance_criteria.join("\n- ")}`,
    );
  }
  const historyBlock = history.length
    ? `Earlier execution reports (treat completed work as done; do not redo it):\n\n${history.join("\n\n")}`
    : "No earlier steps have been completed; this is the first step.";
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
  "stepOutcome": "completed" | "incomplete",
  "report": {
    "summary": "what you did",
    "files_created": ["..."],
    "files_modified": ["..."],
    "outputs": ["key results, commands run, tests, artifacts"],
    "issues": ["anything left open"]
  },
  "deviation": {
    "present": true,
    "reason": "why this step could not be done as planned",
    "forced_changes": ["what you had to change or invent that the plan did not contain"],
    "work_already_done": ["what you did before hitting the problem"]
  }
}

Rules:
- Set status to "success" only when the step completed as written; then set stepOutcome to "completed" and omit deviation.
- For status "deviation", always set stepOutcome. Use "completed" only if the step's intended result/acceptance criteria were achieved despite departing from the planned method. Use "incomplete" if blocked, partially done, or uncertain; never infer completion from partial progress.
- For deviations, provide deviation honestly and describe all work actually completed in report.
- Be precise about files created and modified — the next step and the reviser rely on this report.`;
};

const buildReviserPrompt = ({ planText, history, deviation, affectedStep, stepOutcome }) => {
  const historyBlock = history.length
    ? `Execution reports for earlier and affected work (use as evidence; do not redo completed work):\n\n${history.join("\n\n")}`
    : "No earlier work was completed before this step.";
  const replanInstruction =
    stepOutcome === "completed"
      ? "The coder confirms that the intended result of the affected step WAS achieved, despite deviating from the planned method. Preserve every step before this one unchanged; preserve this affected step as completed; replan only steps after it. The runner will resume at the next step. Do not repeat this completed step."
      : "The coder confirms that the affected step was NOT completed, or completion is uncertain. Preserve every step before this one unchanged. Revise the affected step to make it executable next, and replan later steps only as necessary. The runner will retry the affected step. Do not treat partial work as completion.";

  return `You are Implementation Plan Reviser. Revise the current implementation plan in response to the coder's execution report.

CURRENT PLAN (complete JSON):
${planText}

AFFECTED STEP:
${JSON.stringify(affectedStep, null, 2)}

CODER STEP OUTCOME: ${stepOutcome}

${historyBlock}

CODER DEVIATION REPORT:
${JSON.stringify(deviation, null, 2)}

${replanInstruction}

Revise only from the appropriate point onward. Keep all earlier completed steps unchanged, with their original numbers and order. Incorporate only work verified in the supplied reports. Preserve unaffected future steps if still valid; change dependencies, numbering, actions, and verification only as needed. Do not restart the entire plan.

Return ONLY the complete updated plan as one valid JSON object, with no Markdown or prose. Preserve the current plan's top-level structure and metadata (including project_summary, assumptions, steps, overall_acceptance_criteria, and any other supplied fields) and all required per-step fields (step, goal, actions, dependencies, files_to_create, files_to_modify, expected_result, verification, handoff_notes). Keep a non-empty steps array.`;
};

const extension = createExtension({
  commands: {
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
        steps: loaded.steps.map((step) => ({
          step: step.step,
          title: step.title ?? null,
          goal: step.goal ?? null,
        })),
      };
    },

    async run_plan(input, context) {
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
      const finish = (payload) => {
        flush();
        return payload;
      };

      const params =
        input && typeof input === "object" && !Array.isArray(input) ? input : {};
      const planPath =
        typeof input === "string" ? input : String(params.planPath ?? "").trim();
      const coderName = String(params.coderAgentName ?? DEFAULT_CODER_NAME).trim();
      const reviserName = String(
        params.reviserAgentName ?? DEFAULT_PLANNER_NAME,
      ).trim();
      const startStep = asPositiveInt(params.startStep, 1);
      const maxSteps = asPositiveInt(params.maxSteps, DEFAULT_MAX_STEPS);
      const maxPlanUpdates = asPositiveInt(
        params.maxPlanUpdates,
        DEFAULT_MAX_PLAN_UPDATES,
      );

      const loaded = loadPlan(planPath);
      if (loaded.error) {
        notify(`Plan load failed: ${loaded.error}\n`);
        return finish({ status: "error", stage: "load_plan", error: loaded.error });
      }
      let plan = loaded.plan;
      let steps = loaded.steps;
      const planPathAbs = loaded.path;
      notify(`Loaded plan: ${planPathAbs}\n${steps.length} step(s) in plan.\n`);

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
        agents.find((agent) => agent.name === name) ??
        agents.find((agent) => agent.name.toLowerCase() === name.toLowerCase());
      const coder = findAgent(coderName);
      if (!coder) {
        return finish({
          status: "error",
          stage: "find_coder",
          error: `Coder agent "${coderName}" not found. Saved agents: ${agents.map((agent) => agent.name).join(", ")}`,
        });
      }
      const reviser = findAgent(reviserName);
      if (!reviser) {
        return finish({
          status: "error",
          stage: "find_reviser",
          error: `Plan reviser agent "${reviserName}" not found. Saved agents: ${agents.map((agent) => agent.name).join(", ")}`,
        });
      }
      notify(`Coder: ${coder.name} | Plan reviser: ${reviser.name}\n`);

      const stepHistory = [];
      const stepReports = [];
      const planRevisions = [];
      let planUpdates = 0;
      let executedCount = 0;
      let idx = steps.findIndex((step) => Number(step.step) >= startStep);
      if (idx === -1) idx = 0;

      const runCoder = async (step, attempt) => {
        const prompt = buildCoderPrompt({ step, plan, history: stepHistory, attempt });
        const result = await extension.agents.run(
          { agentId: coder.id, input: prompt },
          { timeoutMs: AGENT_TIMEOUT_MS },
        );
        return result.text ?? "";
      };

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
        notify(`\n>>> Step ${step.step}${step.title ? `: ${step.title}` : ""}\nSending step to coder (${coder.name})...\n`);
        executedCount += 1;

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
          const deviation = {
            present: true,
            reason: "Coder did not return a parseable JSON report after a retry.",
            forced_changes: [],
            work_already_done: [],
            raw_coder_output: rawText.slice(0, 8000),
          };
          parsed = {
            status: "deviation",
            stepOutcome: "incomplete",
            report: { summary: rawText.slice(0, 2000), issues: [deviation.reason] },
            deviation,
          };
        }

        if (parsed.status === "success") {
          const report = parsed.report ?? { summary: "No report returned." };
          stepReports.push({ step: step.step, title: step.title ?? null, report });
          stepHistory.push(compactReport(step, report));
          const files = [
            ...(Array.isArray(report.files_created) ? report.files_created : []),
            ...(Array.isArray(report.files_modified)
              ? report.files_modified.map((file) =>
                  typeof file === "string" ? file : file?.path ?? "",
                )
              : []),
          ].filter(Boolean);
          notify(
            `<<< Step ${step.step} completed successfully.${files.length ? ` Files: ${files.join(", ")}` : ""}\n`,
          );
          idx += 1;
          continue;
        }

        const deviation = parsed.deviation ?? {
          present: true,
          reason: String(parsed.report?.summary ?? "Unspecified deviation."),
          forced_changes: [],
          work_already_done: [],
        };
        const stepOutcome =
          parsed.stepOutcome === "completed" ? "completed" : "incomplete";
        if (parsed.report) {
          stepHistory.push(
            compactReport(step, {
              ...parsed.report,
              stepOutcome,
              note:
                stepOutcome === "completed"
                  ? "The intended result of this step was achieved despite the deviation; do not repeat it."
                  : "This step is incomplete; revise this step and later steps without assuming partial work is complete.",
            }),
          );
        }
        notify(
          `<<< Step ${step.step} DEVIATION (${stepOutcome}): ${deviation.reason ?? "unspecified"}\nSending the execution evidence to plan reviser (${reviser.name})...\n`,
        );

        if (planUpdates >= maxPlanUpdates) {
          stepReports.push({
            step: step.step,
            title: step.title ?? null,
            status: "deviation",
            stepOutcome,
            deviation,
            unresolved: true,
          });
          return finish({
            status: "error",
            stage: "max_plan_updates",
            reason: `Plan reviser was asked ${maxPlanUpdates} time(s) to update the plan; limit reached.`,
            planPath: planPathAbs,
            lastDeviation: deviation,
            completed: stepReports,
            planRevisions,
          });
        }

        const planText = JSON.stringify(plan, null, 2);
        const reviserReply = await extension.agents.run(
          {
            agentId: reviser.id,
            input: buildReviserPrompt({
              planText,
              history: stepHistory,
              deviation,
              affectedStep: step,
              stepOutcome,
            }),
          },
          { timeoutMs: AGENT_TIMEOUT_MS },
        );
        const updatedPlan = extractJson(reviserReply.text ?? "");
        if (!updatedPlan || !Array.isArray(updatedPlan.steps)) {
          stepReports.push({
            step: step.step,
            title: step.title ?? null,
            status: "deviation",
            stepOutcome,
            deviation,
            unresolved: true,
            reviserError: "Plan reviser did not return a valid updated plan JSON.",
          });
          return finish({
            status: "error",
            stage: "plan_update",
            error: "Plan reviser did not return a valid updated plan JSON.",
            reviserReply: (reviserReply.text ?? "").slice(0, 4000),
            planPath: planPathAbs,
            completed: stepReports,
            planRevisions,
          });
        }

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
          stepOutcome,
          stepCount: steps.length,
        });

        const sameStepIndex = steps.findIndex(
          (candidate) => Number(candidate.step) === Number(step.step),
        );
        if (stepOutcome === "completed") {
          if (sameStepIndex !== -1) {
            idx = sameStepIndex + 1;
          } else {
            const nextIndex = steps.findIndex(
              (candidate) => Number(candidate.step) > Number(step.step),
            );
            idx = nextIndex === -1 ? steps.length : nextIndex;
          }
          notify(`Plan updated and saved (revision ${planUpdates}). Step ${step.step} was completed; continuing from the next step.\n`);
        } else {
          let retryIndex = sameStepIndex;
          if (retryIndex === -1) {
            retryIndex = steps.findIndex(
              (candidate) => Number(candidate.step) >= Number(step.step),
            );
          }
          idx = retryIndex === -1 ? Math.min(idx, steps.length) : retryIndex;
          executedCount -= 1;
          notify(`Plan updated and saved (revision ${planUpdates}). Step ${step.step} is incomplete; retrying the revised affected step.\n`);
        }
        stepReports.push({
          step: step.step,
          title: step.title ?? null,
          status: "deviation",
          stepOutcome,
          report: parsed.report ?? null,
          deviation,
          revisedPlan: true,
        });
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
