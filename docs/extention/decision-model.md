# Using the Jev Decision Model from an Extension

**Search keywords:** decision, jev, mocu.decision.ask, decisions api,
openrouter, noul, choice, score, probability, questions, state, decision
api, typed questions, calibrated, decision.ask, DecisionApi

Extensions can ask **typed probabilistic questions** through Mocu's
configured Jev decision model (the OpenRouter Decisions API, the same model
Mocu itself uses — see `src/services/ai/tools/decision/Jev_model.ts`). The
model does **not** generate text; it returns **calibrated probabilities**:

- `"noul"` — a yes/no probability
- `"choice"` — a pick from caller-defined options
- `"score"` — a position on an ordered rubric

The API key / base URL / model come from Mocu's settings (Decision section)
— the extension never sees or handles any key.

## Node SDK

```js
const result = await extension.decision.ask({
  state: { cpuLoad: 0.92, memoryFreeMb: 180 },
  questions: {
    needsAttention: {
      type: "noul",
      criteria: {
        true: "The system is overloaded and needs attention.",
        false: "The system is running normally.",
      },
    },
    action: {
      type: "choice",
      criteria: {
        wait: "Nothing to do, load is transient.",
        warn: "Warn the user.",
        restart: "Restart the heavy process.",
      },
    },
  },
});

console.error(result); // raw OpenRouter Decisions API result
```

## Python SDK

```python
result = extension.decision.ask(
    state={"cpu_load": 0.92, "memory_free_mb": 180},
    questions={
        "needs_attention": {
            "type": "noul",
            "criteria": {
                "true": "The system is overloaded and needs attention.",
                "false": "The system is running normally.",
            },
        },
    },
)
```

## Parameters (`DecisionAskParams`)

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `state` | any JSON | yes | The state (string, object, or array) the questions are asked about. |
| `questions` | object | yes | Map of question name → typed question (`type` + `criteria`, optional `instructions`). At most 32 questions per call. |

Question `type` / `criteria` shapes:

| Type | `criteria` shape |
|------|------------------|
| `noul` | `{ "true": "...", "false": "..." }` |
| `choice` | object of option name → description |
| `score` | array of ordered rubric descriptions |

## Result

The **raw OpenRouter Decisions API result** is passed through verbatim (one
answer per question key). Inspect it once and map it into your own return
value — treat it as unknown JSON.

## Wire format (for reference)

```json
{ "jsonrpc": "2.0", "id": 9, "method": "mocu.decision.ask",
  "params": { "state": "cpu 92%", "questions": { "overloaded": { "type": "noul",
  "criteria": { "true": "overloaded", "false": "fine" } } } } }
```

Host reply: `{ "jsonrpc": "2.0", "id": 9, "result": { ... } }`.

## Rules and gotchas

- The Decision (Jev) API key must be configured in **Mocu Settings →
  Decision**; otherwise the call fails with a clear error — handle it and
  return a friendly error from your command.
- The call must happen while the protocol loop is running (after
  `extension.start()` / `extension.run()`).
- It counts against the command's `timeoutSeconds` like any host call.

## Related documents

- Host LLM calls: [llm-calls.md](llm-calls.md)
- Embedding model calls: [embedding-model.md](embedding-model.md)
- Wire protocol: [protocol-reference.md](protocol-reference.md)
