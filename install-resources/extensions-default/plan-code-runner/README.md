# Plan Code Runner

The runner checkpoints progress so an interrupted execution can continue without rerunning completed plan steps.

## Start or continue

Run `run_plan` with the original plan path:

```json
{"planPath":"E:\\path\\to\\implementation-plan.json"}
```

Optional `projectPath` tells the coder which project root folder to work in:

```json
{"planPath":"E:\\path\\to\\implementation-plan.json","projectPath":"E:\\path\\to\\project"}
```

If `projectPath` is omitted, the runner uses the plan's top-level `project_path` field when present; otherwise it uses the directory containing the plan file. This fallback supports Implementation Plan Architect output, which saves the plan in the project but may not include a `project_path` field. A supplied `projectPath` or plan `project_path` that does not exist or is not a directory fails before any agent is invoked.

For each plan, progress is stored beside it at:

```text
<planPath>.run-state.json
```

The checkpoint records a fingerprint of the current plan structure, completed step reports, execution history, plan revisions, the next step, and any in-progress step. It is updated atomically before invoking an agent and after each completed/revised step. If a plan changes outside Plan Code Runner, resumption refuses to use a stale checkpoint; retain the original plan or deliberately start a new run.

## Resume after interruption/error

Call `resume_plan` with the same original plan path:

```json
{"planPath":"E:\\path\\to\\implementation-plan.json"}
```

Completed steps are skipped. If the runner stopped during an in-progress step, it invokes the coder for that step with explicit recovery instructions to inspect relevant current files and finish remaining work rather than blindly repeating non-idempotent actions.

An unfinished run cannot be restarted from `run_plan` by accident. To intentionally discard its checkpoint and start over, call `run_plan` with `startNew: true`; the previous checkpoint is archived next to the plan before a new one is created. Do this only when restarting is intended.

If the application process is force-killed, the last durable checkpoint remains. A crash in the middle of a coder step leaves that step marked in progress; resumption therefore rechecks that step, while all earlier checkpointed steps remain completed.
