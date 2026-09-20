# Using the Embedding Model from an Extension

**Search keywords:** embedding, embeddings, mocu.embedding.embed, vector,
vectors, embed, embedText, similarity, cosine, EmbeddingApi, embedDocuments,
text to vector, semantic, embedding model, embedding.embed

Extensions can create **embedding vectors** with Mocu's configured
embedding model (the same provider / model / API key Mocu itself uses for
memory — Settings → Embedding). The extension never handles any key.

## Node SDK

```js
// Multiple texts in one call (one vector per text, same order):
const { embeddings } = await extension.embedding.embed({
  texts: ["first text", "second text"],
});

// Or a single text:
const vector = await extension.embedding.embedText("first text");
console.error(vector.length); // e.g. 1536
```

## Python SDK

```python
result = extension.embedding.embed(["first text", "second text"])
vectors = result["embeddings"]

vector = extension.embedding.embed_text("first text")
```

## Parameters (`EmbeddingEmbedParams`)

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `texts` | string[] | yes | 1–64 non-empty texts, each ≤ 32 000 characters. Returned vectors follow the input order. |

## Result (`EmbeddingEmbedResult`)

```json
{ "embeddings": [[0.012, -0.983, ...], [0.441, 0.007, ...]] }
```

## Similarity

The host does **not** compute similarity for you — compute cosine
similarity yourself when you need it:

```js
function cosine(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}
```

All vectors in one comparison must come from the same model (same
dimensionality).

## Wire format (for reference)

```json
{ "jsonrpc": "2.0", "id": 11, "method": "mocu.embedding.embed",
  "params": { "texts": ["hello"] } }
```

Host reply: `{ "jsonrpc": "2.0", "id": 11,
"result": { "embeddings": [[...]] } }`.

## Rules and gotchas

- The embedding model / base URL / API key must be configured in
  **Mocu Settings → Embedding**; otherwise the call fails with a clear
  error — handle it and return a friendly error from your command.
- The call must happen while the protocol loop is running (after
  `extension.start()` / `extension.run()`).
- It counts against the command's `timeoutSeconds` like any host call.

## Related documents

- Host LLM calls: [llm-calls.md](llm-calls.md)
- Jev decision model: [decision-model.md](decision-model.md)
- Wire protocol: [protocol-reference.md](protocol-reference.md)
