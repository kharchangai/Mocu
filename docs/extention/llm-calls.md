# Calling the Mocu Host LLM from an Extension

**Search keywords:** llm, generate, mocu.llm.generate, prompt, systemPrompt,
system_prompt, temperature, maxTokens, max_tokens, host llm, ai call,
extension.llm, LlmApi, text result, ask llm, no api key, provider

Extensions can use Mocu's own configured LLM (the user's provider/API key)
through a single JSON-RPC host method: **`mocu.llm.generate`**. The SDKs
wrap it so you never touch the wire format.

## Node SDK

```js
const result = await extension.llm.generate({
  prompt: "Summarize this text: ...",
  systemPrompt: "You are a concise assistant.",
  temperature: 0.7,   // optional
  maxTokens: 300,     // optional
});

console.error(result.text); // the generated text
```

## Python SDK

```python
result = extension.llm.generate(
    "Summarize this text: ...",
    system_prompt="You are a concise assistant.",
    temperature=0.7,     # optional
    max_tokens=300,      # optional
)
text = result["text"]
```

## Parameters (`LlmGenerateParams`)

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `prompt` | string | yes | Non-empty; SDK trims it and throws on empty. |
| `systemPrompt` | string | no | System instruction for the model. |
| `temperature` | number | no | Sampling temperature. |
| `maxTokens` | number | no | Maximum tokens to generate. |

## Result (`LlmGenerateResult`)

```json
{ "text": "The generated answer..." }
```

## Rules and gotchas

- **The prompt is a plain completion** — the extension must build its own
  prompt including any context it wants (the current user message is *not*
  forwarded automatically; commands receive `input` only).
- **The call must happen while the protocol loop is running.** In Node this
  means: after `extension.start()` has been called (it is called in your
  entry file before handlers run). It works from any async helper, not just
  inside `commands` — see the `llm-outside-example` below.
- The host LLM is the user's configured provider; if none is configured the
  request fails and the SDK rejects/raises — handle it and return a friendly
  error from your command.
- Each command's total time counts against its `timeoutSeconds` — LLM calls
  can be slow, so consider a larger timeout in the manifest for LLM-heavy
  commands (see [manifest-reference.md](manifest-reference.md)).

## Example: LLM call outside a command handler

From `extensions-examples/llm-outside-example/index.js`:

```js
async function askLlm(extension, question) {
  const result = await extension.llm.generate({
    prompt: question,
    systemPrompt: "You are a helpful assistant. Keep the answer to one short sentence.",
    maxTokens: 120,
  });
  return { reply: result.text.trim() };
}

const extension = createExtension({
  commands: {
    async ask(input) {
      return await askLlm(extension, input?.question ?? "What is 2 + 2?");
    },
  },
});

extension.start();
```

## Wire format (for reference)

Request (handled by the SDK):

```json
{ "jsonrpc": "2.0", "id": 7, "method": "mocu.llm.generate",
  "params": { "prompt": "hi", "systemPrompt": "..." } }
```

Success response from the host:

```json
{ "jsonrpc": "2.0", "id": 7, "result": { "text": "Hello!" } }
```

## Related documents

- Wire protocol: [protocol-reference.md](protocol-reference.md)
- Streaming LLM progress to chat: [streaming-activity.md](streaming-activity.md)
