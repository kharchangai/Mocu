/* Smoke test: drive plan-code-runner over its stdin/stdout JSON-RPC protocol,
 * simulating the host side (mocu.agents.list / mocu.agents.run) with scripted
 * coder & planner replies to exercise the full success -> deviation -> plan
 * update -> re-run -> completion loop. */
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ext = spawn("node", ["index.js"], {
  cwd: dirname(fileURLToPath(import.meta.url)),
  stdio: ["pipe", "pipe", "inherit"],
});

const pending = new Map();
let nextId = 1;

let coderCalls = 0;
let plannerCalls = 0;

const reply = (id, result) =>
  ext.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);

const coderScript = () => {
  coderCalls += 1;
  if (coderCalls === 1) {
    return JSON.stringify({
      status: "success",
      report: {
        summary: "Created the config module.",
        files_created: ["src/config.ts"],
        files_modified: [],
        outputs: ["npm test: 3 passed"],
        issues: [],
      },
      deviation: { present: false },
    });
  }
  if (coderCalls === 2) {
    // step 2 first attempt: deviation
    return JSON.stringify({
      status: "deviation",
      report: {
        summary: "Started wiring, but the planned API does not exist.",
        files_created: [],
        files_modified: [{ path: "src/config.ts", change: "added fallback" }],
        outputs: [],
        issues: ["planned dependency missing"],
      },
      deviation: {
        present: true,
        reason: "The planned dependency module does not exist in the repo.",
        forced_changes: ["Added a fallback loader inside src/config.ts"],
        work_already_done: ["Created src/config.ts"],
      },
    });
  }
  // step 2 retry after plan update: success
  return JSON.stringify({
    status: "success",
    report: {
      summary: "Completed wiring with the updated plan.",
      files_created: ["src/wiring.ts"],
      files_modified: [{ path: "src/config.ts", change: "exported load()" }],
      outputs: ["npm test: 5 passed"],
      issues: [],
    },
    deviation: { present: false },
  });
};

const plannerScript = (params) => {
  plannerCalls += 1;
  const inputStr = String(params?.input ?? "");
  const marker = "PLAN FILE (current):";
  let plan;
  try {
    const rest = inputStr.slice(inputStr.indexOf(marker) + marker.length);
    const start = rest.indexOf("{");
    const end = rest.indexOf("\n\nFAILED");
    plan = JSON.parse(rest.slice(start, end === -1 ? undefined : end));
  } catch {
    plan = {};
  }
  if (!Array.isArray(plan.steps)) plan.steps = [];
  return JSON.stringify(plan);
};

let buf = "";
ext.stdout.on("data", (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    // response to OUR request
    if (msg.result !== undefined || msg.error !== undefined) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
      continue;
    }
    // request FROM the extension (host methods)
    if (msg.method === "mocu.agents.list") {
      reply(msg.id, [
        { id: "coder1", name: "Code Agent", description: "coder" },
        { id: "planner1", name: "Implementation Plan Architect", description: "planner" },
      ]);
      continue;
    }
    if (msg.method === "mocu.agents.run") {
      const input = String(msg.params?.input ?? "");
      if (input.includes("implementation planning agent")) {
        reply(msg.id, {
          agentId: "planner1",
          name: "Implementation Plan Architect",
          text: plannerScript(msg.params),
        });
      } else {
        reply(msg.id, { agentId: "coder1", name: "Code Agent", text: coderScript() });
      }
      continue;
    }
    if (msg.method === "mocu.extension.activity") {
      process.stdout.write(`[activity] ${msg.params?.text ?? ""}`);
    }
  }
});

const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ext.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 20000);
  });

const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  OK: ${msg}`);
};

const run = async () => {
  console.log("== preview_plan on a real plan ==");
  const preview = await request("extension.execute", {
    command: "preview_plan",
    input: { planPath: "E:\\mocube\\mocu\\ui-performance-implementation-plan.json" },
    context: {},
    config: {},
  });
  assert(preview.success === true, `preview succeeded: ${JSON.stringify(preview).slice(0, 300)}`);
  assert(preview.output && preview.output.ok === true, "preview output ok");
  assert(preview.output.stepCount === 7, `plan has 7 steps (got ${preview.output.stepCount})`);

  console.log("== preview_plan on missing file ==");
  const bad = await request("extension.execute", {
    command: "preview_plan",
    input: { planPath: "E:\\nope\\missing.json" },
    context: {},
    config: {},
  });
  assert(bad.success === true && bad.output.ok === false, "missing file handled gracefully");

  console.log("== run_plan full loop (success -> deviation -> update -> success) ==");
  const dir = mkdtempSync(join(tmpdir(), "pcr-"));
  const planPath = join(dir, "plan.json");
  const plan = {
    project_summary: { project: "smoke" },
    assumptions: [],
    steps: [
      { step: 1, title: "Create config", goal: "Make config module" },
      { step: 2, title: "Wire it", goal: "Wire config to app" },
    ],
    overall_acceptance_criteria: ["tests pass"],
  };
  writeFileSync(planPath, JSON.stringify(plan, null, 2));

  const res = await request("extension.execute", {
    command: "run_plan",
    input: {
      planPath,
      coderAgentName: "Code Agent",
      plannerAgentName: "Implementation Plan Architect",
    },
    context: { toolCallId: "t1", toolName: "run_plan" },
    config: {},
  });
  assert(res.success === true, "run_plan returned success envelope");
  const out = res.output;
  console.log("run output:", JSON.stringify(out, null, 2).slice(0, 2500));
  assert(out.status === "completed", `status completed (got ${out.status})`);
  assert(out.executedSteps === 2, `2 net coder runs (retry after plan update not double-counted) (got ${out.executedSteps})`);
  assert(out.planUpdates === 1, `1 plan update (got ${out.planUpdates})`);
  assert(out.completed.length === 2, `2 completed step reports (got ${out.completed.length})`);
  assert(coderCalls === 3, `coder called 3x (got ${coderCalls})`);
  assert(plannerCalls === 1, `planner called 1x (got ${plannerCalls})`);
  const updated = JSON.parse(readFileSync(planPath, "utf8"));
  assert(Array.isArray(updated.steps) && updated.steps.length === 2, "plan file still valid after update");
  const backup = `${planPath}.backup-1`;
  assert(existsSync(backup), "backup of original plan created");

  ext.stdin.end();
  ext.kill();
  console.log("\nALL SMOKE TESTS PASSED");
  process.exit(0);
};

run().catch((e) => {
  console.error("\nTEST FAILED:", e.message);
  ext.kill();
  process.exit(1);
});