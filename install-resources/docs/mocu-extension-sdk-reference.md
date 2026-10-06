---
id: mocu-extension-sdk-reference
title: Mocu Extension SDK Reference
description: Reference for verified Mocu extension SDK APIs, host behavior,
  validation limits, and packaging requirements. Retrieve it when building or
  reviewing a Node or Python extension, or when checking SDK availability and
  local vendoring.
keywords:
  - Mocu extension SDK
  - Node SDK
  - Python SDK
  - extension API reference
  - host LLM
  - structured decisions
  - embeddings
  - saved agents
  - chat interaction
  - streaming progress
  - SDK packaging
  - local vendoring
  - npm E404
  - PyPI availability
---
# Mocu Extension SDK Reference

## Scope and SDK packages

This reference documents only capabilities verified in the Mocu SDK and host implementation.

- Node package: `@mocu/extension-sdk`
  - Exports `createExtension`, `MocuExtension`, `LlmApi`, `DecisionApi`, `EmbeddingApi`, `AgentsApi`, `ExtensionUiApi`, and related types.
- Python package: `mocu_extension_sdk`
  - Exports `create_extension`, `MocuExtension`, and the corresponding API classes.
- Each extension instance exposes `extension.llm`, `extension.decision`, `extension.embedding`, and `extension.agents`.
- For each command invocation, the context exposes chat UI access as `context.mocu.ui` in Node or `context["mocu"]["ui"]` in Python.

## Host LLM

Use the host LLM API to generate text with the user’s configured Mocu model. Extensions do not need to bundle a model for this API.

**Node:**

```js
const result = await extension.llm.generate({
  prompt: "Summarize this",
  systemPrompt: "Be concise"
});
return result.text;
```

The Node method signature is `extension.llm.generate({prompt, systemPrompt?, temperature?, maxTokens?})`. It returns `{text: string}`.

**Python:**

```python
result = extension.llm.generate("Summarize this", system_prompt="Be concise")
return result["text"]
```

The Python method signature is `extension.llm.generate(prompt, system_prompt=None, temperature=None, max_tokens=None)`. It returns a dictionary containing `text`.

**Host validation and limits:**

- `prompt` must be non-empty and can contain at most 100,000 characters.
- `systemPrompt` can contain at most 20,000 characters.
- A finite `temperature` is clamped to the range `[0, 2]`.
- `maxTokens` is accepted when it is a positive integer.

## Structured decisions (Jev)

Use `extension.decision.ask` for structured probabilistic judgments, not ordinary free-form text generation. The API returns the raw probabilities or decision result, rather than free-form text.

**Node:**

```js
const result = await extension.decision.ask({ state, questions });
```

**Python:**

```python
result = extension.decision.ask(state=state, questions=questions)
```

- `state` is required.
- `questions` must be a non-empty object. Its keys are caller-defined.
- Supported question types are `noul`, `choice`, and `score`.
- Criteria can be expressed as true/false descriptions, keyed choices, or score labels.
- The host currently allows at most 32 questions per call.

## Embeddings

Use the configured Mocu embedding model through `extension.embedding`.

**Node:**

```js
const result = await extension.embedding.embed({ texts: ["first text", "second text"] });
const vector = await extension.embedding.embedText("one text");
```

- `embed({texts: [...]})` returns `{embeddings: number[][]}` in the same order as the input texts.
- `embedText(text)` is a convenience method that returns one `number[]`.

**Python:**

```python
result = extension.embedding.embed(["first text", "second text"])
```

Python `embed(texts)` returns a result dictionary.

**Host validation and limits:**

- At least one non-empty text is required.
- A call can contain at most 64 texts.
- Each text can contain at most 32,000 characters.

## Saved agents

Saved-agent listing and invocation require the manifest permission `permissions: ["agents.invoke"]`. This is the permission currently enforced by the host for both `agents.list` and `agents.run`.

**Node:**

```js
const agents = await extension.agents.list();
const result = await extension.agents.run({ agentId, input }, { timeoutMs, signal });
```

- `extension.agents.list()` returns public descriptors shaped as `{id, name, description}[]`.
- `extension.agents.run({agentId, input}, {timeoutMs?, signal?})` returns `{agentId, name, text}`.

**Python:**

```python
agents = extension.agents.list()
result = extension.agents.run(agent_id, input, timeout=timeout, cancel_event=cancel_event)
```

**Host behavior and limits:**

- Agent ID and input must be non-empty.
- Input is limited to 100,000 characters.
- Extensions cannot select an arbitrary project or filesystem path. The agent runs with an empty `projectPath`.
- Do not invoke a user’s saved agents without a user request or need. If no saved agent is available, disclose that gracefully.

## Chat interaction

Only a command declared with `interactive: true` may use the chat interaction API.

**Node:**

```js
const result = await context.mocu.ui.interact(
  { title, message, input: true, inputPlaceholder, buttons },
  signal
);
```

**Python:**

```python
result = context["mocu"]["ui"].interact(
    title=title,
    message=message,
    input=True,
    input_placeholder=input_placeholder,
    buttons=buttons,
    cancel_event=cancel_event,
)
```

The user can enter text, click a button, or do both. The result is `{actionId, input?}`.

- A button requires a unique, non-empty `id` and a `label`. Its optional `variant` must be `primary`, `secondary`, or `danger`.
- A maximum of 8 buttons is allowed.
- Enable text input or provide a valid button.
- The interaction waits indefinitely for a reply or cancellation. The context must contain an active chat.
- The host permits only one pending interaction per chat.
- Use interaction only when genuinely required, and offer clear choices and a cancellation path.

## Progress and cancellation

A command must declare `streaming: true` to report progress. The SDK exposes `extension.notify(method, params)` for notifications.

For a live chat card, send a one-way `mocu.extension.activity` notification containing the context’s `toolCallId`, `toolName`, and accumulated `text`. Keep updates bounded and useful. Ordinary stdout is not progress.

Cancellation can arrive through `mocu.extension.interaction.cancel`. The SDK supports:

- Node `AbortSignal` for agent and UI calls.
- Python `cancel_event` for agent and UI calls.

## Packaging and SDK availability

The import examples in this reference show SDK package names; they do not guarantee that those packages can currently be fetched from a public registry.

- As of 2026-10-05, `npm view @mocu/extension-sdk@0.1.0 version` returned E404. Do not tell extension authors to rely on public npm availability.
- Independent distributable extensions must vendor the built Node SDK and its contracts dependency inside the extension directory and use local dependencies.
- Mocu runs `npm install` after extraction and has no source-repository path. Packaging therefore cannot depend on SDK files available only in the source repository.
- For Python, do not assume PyPI availability; Mocu does not run `pip`.
- See [SDK Local Vendoring and Packaging](mocu-extension-sdk-local-vendoring-and-packaging.md) for the canonical guide to the required packaging layout and verification.
- See also [Extension Development](mocu-extension-development.md) and [Extension Runtime](mocu-extension-runtime.md).

## Permissions, safety, and implementation boundaries

- Do not treat permissions as a generic prompt or assume unverified permission strings.
- The reviewed host implementation specifically checks `agents.invoke` before listing or running saved agents.
- Other host APIs are routed through `host-service` without that named permission check in the reviewed implementation. Do not invent permission strings or promise additional enforcement.
- Handle user and API-key data carefully, validate inputs, and catch errors.
- Never print protocol data to stdout.

## Verified implementation sources

- Node SDK: `extension-system/sdk-node/src/index.ts`, `extension.ts`, `llm.ts`, `decision.ts`, `embedding.ts`, `agents.ts`, and `ui.ts`.
- Python SDK: matching modules under `extension-system/sdk-python/mocu_extension_sdk`.
- Contracts: `extension-system/contracts/src/{llm,decision,embedding,agents,protocol}.ts`.
- Active handlers: `src/extensions/services/host-service.ts` and `extension-agent-service.ts`.

## When to use this document

Retrieve this reference when building or reviewing a Mocu extension that needs official SDK capabilities in Node or Python, or when checking API identifiers, manifest requirements, input limits, host behavior, chat interaction, cancellation, or streaming progress. Also use it when determining whether the SDK can be installed publicly and how to package local SDK dependencies for a distributable extension.
