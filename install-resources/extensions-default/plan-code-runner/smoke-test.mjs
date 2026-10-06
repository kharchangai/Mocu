/* Focused JSON-RPC smoke tests for Plan Code Runner persistence and resume. */
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = dirname(fileURLToPath(import.meta.url));
let ext;
let pending = new Map();
let nextId = 1;
let scenario = "success";
let coderCalls = 0;
let reviserCalls = 0;
let currentPlan = null;
let interruptCall = 0;
let interruptedOnce = false;
let interruptReviserOnce = false;
let buffer = "";

const spawnExtension = () => {
  ext = spawn("node", ["index.js"], { cwd, stdio: ["pipe", "pipe", "inherit"] });
  ext.stdout.on("data", onStdout);
};
const reply = (id, result) => ext.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
const validSuccess = (summary) => JSON.stringify({ status: "success", stepOutcome: "completed", report: { summary, files_created: [], files_modified: [], outputs: [], issues: [] } });
const validDeviation = () => JSON.stringify({
  status: "deviation", stepOutcome: "completed",
  report: { summary: "Intended result achieved by alternate method.", files_created: [], files_modified: [], outputs: [], issues: [] },
  deviation: { reason: "Alternate method achieved the intended result.", forced_changes: [], work_already_done: ["Intended result completed."] },
});

function onStdout(chunk) {
  buffer += chunk.toString();
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.result !== undefined || msg.error !== undefined) {
      const item = pending.get(msg.id);
      if (item) { pending.delete(msg.id); msg.error ? item.reject(new Error(msg.error.message)) : item.resolve(msg.result); }
      continue;
    }
    if (msg.method === "mocu.agents.list") {
      reply(msg.id, [
        { id: "coder-id", name: "coder", description: "test coder" },
        { id: "reviser-id", name: "Implementation Plan Reviser", description: "test reviser" },
      ]);
      continue;
    }
    if (msg.method === "mocu.agents.run") {
      if (msg.params?.agentId === "reviser-id") {
        reviserCalls += 1;
        if (scenario === "revision-interrupt" && !interruptReviserOnce) {
          interruptReviserOnce = true;
          ext.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "simulated reviser interruption" } })}\n`);
          continue;
        }
        const revised = structuredClone(currentPlan);
        revised.audit = { revised: true };
        reply(msg.id, { agentId: "reviser-id", name: "Implementation Plan Reviser", text: JSON.stringify(revised) });
        continue;
      }
      coderCalls += 1;
      if (scenario === "interrupt" && coderCalls === interruptCall && !interruptedOnce) {
        interruptedOnce = true;
        ext.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "simulated coder interruption" } })}\n`);
        continue;
      }
      let text;
      if (scenario === "format-retry" && coderCalls === 1) text = "not json";
      else if ((scenario === "deviation" || scenario === "revision-interrupt") && coderCalls === 2) text = validDeviation();
      else text = validSuccess(`step ${coderCalls} done`);
      reply(msg.id, { agentId: "coder-id", name: "coder", text });
    }
  }
}

const request = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ext.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); } }, 30000);
  timer.unref?.();
});
const assert = (condition, message) => { if (!condition) throw new Error(`ASSERTION FAILED: ${message}`); console.log(`OK: ${message}`); };
const makePlan = (steps) => ({ project_summary: "checkpoint smoke test", assumptions: [], steps, overall_acceptance_criteria: ["valid reports"] });
const makePlanFile = (plan) => { const dir = mkdtempSync(join(tmpdir(), "pcr-smoke-")); const path = join(dir, "plan.json"); writeFileSync(path, JSON.stringify(plan, null, 2)); return path; };
const command = (name, planPath, options = {}) => request("extension.execute", { command: name, input: { planPath, ...options }, context: { toolCallId: `test-${nextId}`, toolName: name }, config: {} });
const restartExtension = async () => {
  const old = ext;
  await new Promise((resolve) => { const timer = setTimeout(() => { old.kill(); resolve(); }, 500); old.once("exit", () => { clearTimeout(timer); resolve(); }); old.stdin.end(); });
  pending = new Map(); nextId = 1; buffer = ""; spawnExtension(); await new Promise((resolve) => setTimeout(resolve, 100));
};

const run = async () => {
  spawnExtension();
  console.log("== preview accepts current plan schema ==");
  const previewPath = makePlanFile(makePlan([{ step: 1, actions: "Focused task", dependencies: [], expected_result: "done" }]));
  const preview = await command("preview_plan", previewPath);
  assert(preview.success && preview.output.ok && preview.output.stepCount === 1, "preview accepts steps without title/goal");
  assert(preview.output.steps[0].goal === "Focused task", "preview uses actions as fallback description");
  assert(preview.output.resumeAvailable === false, "fresh plan has no checkpoint");

  console.log("== invalid plan rejected before agent calls ==");
  const invalidPath = makePlanFile(makePlan([{ step: 1 }, { step: 1 }]));
  const before = coderCalls + reviserCalls;
  const invalid = await command("preview_plan", invalidPath);
  assert(invalid.success && !invalid.output.ok && coderCalls + reviserCalls === before, "invalid plan rejected without agent calls");

  console.log("== normal execution ==");
  scenario = "success"; coderCalls = 0; reviserCalls = 0;
  const normalPath = makePlanFile(makePlan([{ step: 1, actions: "First", dependencies: [], expected_result: "first" }, { step: 2, actions: "Second", dependencies: [1], expected_result: "second" }]));
  const normal = await command("run_plan", normalPath);
  assert(normal.output.status === "completed" && coderCalls === 2 && reviserCalls === 0, "one coder call per step");
  assert(existsSync(`${normalPath}.run-state.json`), "run state saved beside plan");

  console.log("== one report-format retry ==");
  scenario = "format-retry"; coderCalls = 0; reviserCalls = 0;
  const formatPath = makePlanFile(makePlan([{ step: 1, actions: "One", dependencies: [], expected_result: "done" }]));
  const format = await command("run_plan", formatPath);
  assert(format.output.status === "completed" && coderCalls === 2 && reviserCalls === 0, "invalid format retries once only");

  console.log("== deviation revision skips completed affected step ==");
  scenario = "deviation"; coderCalls = 0; reviserCalls = 0;
  currentPlan = makePlan([{ step: 1, actions: "First", dependencies: [], expected_result: "first" }, { step: 2, actions: "Alternate", dependencies: [1], expected_result: "second" }, { step: 3, actions: "Third", dependencies: [2], expected_result: "third" }]);
  const deviationPath = makePlanFile(currentPlan);
  const deviation = await command("run_plan", deviationPath);
  assert(deviation.output.status === "completed" && coderCalls === 3 && reviserCalls === 1, "completed deviation is not rerun");
  assert(existsSync(`${deviationPath}.backup-1`) && JSON.parse(readFileSync(deviationPath, "utf8")).audit?.revised, "plan backed up and revision persisted");

  console.log("== maxSteps checkpoint ==");
  scenario = "success"; coderCalls = 0; reviserCalls = 0;
  const limitPath = makePlanFile(makePlan([{ step: 1, actions: "One", dependencies: [], expected_result: "one" }, { step: 2, actions: "Two", dependencies: [1], expected_result: "two" }]));
  const limited = await command("run_plan", limitPath, { maxSteps: 1 });
  const limitState = JSON.parse(readFileSync(`${limitPath}.run-state.json`, "utf8"));
  assert(limited.output.status === "paused" && coderCalls === 1 && limitState.completed.length === 1 && limitState.nextIndex === 1, "bounded run pauses with completed checkpoint");
  assert((await command("preview_plan", limitPath)).output.resumeAvailable, "preview indicates resume available");

  console.log("== process restart resumes interrupted coder step ==");
  scenario = "interrupt"; coderCalls = 0; reviserCalls = 0; interruptedOnce = false;
  currentPlan = makePlan([{ step: 1, actions: "First", dependencies: [], expected_result: "first" }, { step: 2, actions: "Second", dependencies: [1], expected_result: "second" }]);
  const resumePath = makePlanFile(currentPlan); interruptCall = 2;
  const interrupted = await command("run_plan", resumePath);
  assert(interrupted.output.status === "paused" && interrupted.output.runStatePath.endsWith(".run-state.json"), "coder error pauses and returns checkpoint path");
  const interruptedState = JSON.parse(readFileSync(`${resumePath}.run-state.json`, "utf8"));
  assert(interruptedState.completed.length === 1 && interruptedState.inProgressStep === 2, "checkpoint preserves completed and in-progress steps");
  await restartExtension(); scenario = "success";
  const resumed = await command("resume_plan", resumePath);
  assert(resumed.output.status === "completed" && coderCalls === 3, "new process resumes step 2 without repeating completed step 1");
  assert(JSON.parse(readFileSync(`${resumePath}.run-state.json`, "utf8")).completed.length === 2, "resumed run checkpoints all completed steps");

  console.log("== pending deviation resumes revision without rerunning coder ==");
  scenario = "revision-interrupt"; coderCalls = 0; reviserCalls = 0; interruptReviserOnce = false;
  currentPlan = makePlan([{ step: 1, actions: "Achieve alternate result", dependencies: [], expected_result: "first" }, { step: 2, actions: "Next", dependencies: [1], expected_result: "second" }]);
  const revisionPath = makePlanFile(currentPlan);
  const revisionPause = await command("run_plan", revisionPath);
  assert(revisionPause.output.status === "paused", "reviser error pauses the run");
  assert(JSON.parse(readFileSync(`${revisionPath}.run-state.json`, "utf8")).pendingDeviation?.step === 2, "checkpoint stores pending deviation separately");
  await restartExtension(); scenario = "success";
  const revisionResume = await command("resume_plan", revisionPath);
  assert(revisionResume.output.status === "completed", "resume finishes pending revision and remaining plan");
  assert(coderCalls === 2 && reviserCalls === 2, `resume retries only the pending revision; coder not called again (coder=${coderCalls}, reviser=${reviserCalls})`);

  console.log("== stale checkpoint rejected; explicit restart archives old state ==");
  const changedPath = makePlanFile(makePlan([{ step: 1, actions: "First", dependencies: [], expected_result: "first" }, { step: 2, actions: "Second", dependencies: [1], expected_result: "second" }]));
  assert((await command("run_plan", changedPath, { maxSteps: 1 })).output.status === "paused", "stale test checkpoint created");
  const edited = JSON.parse(readFileSync(changedPath, "utf8")); edited.steps[1].actions = "Changed externally"; writeFileSync(changedPath, JSON.stringify(edited, null, 2));
  const stale = await command("resume_plan", changedPath);
  assert(stale.output.status === "error" && stale.output.stage === "resume_state", "changed plan cannot reuse stale checkpoint");
  assert((await command("run_plan", changedPath, { startNew: true })).output.status === "completed", "explicit new run succeeds");
  assert(readdirSync(dirname(changedPath)).some((name) => name.startsWith("plan.json.run-state.json.archived-")), "old checkpoint archived");

  ext.stdin.end(); ext.kill(); console.log("ALL SMOKE TESTS PASSED");
};
run().catch((error) => { console.error("TEST FAILED:", error.stack ?? error.message); ext.kill(); process.exitCode = 1; });
