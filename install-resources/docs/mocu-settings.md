---
id: mocu-settings
title: Mocu Settings
description: Explains Mocu’s locally saved provider, model, speech, vision, web
  search, decision-model, and document-retrieval settings. Retrieve it when a
  user asks how to configure Mocu or what a setting does.
keywords:
  - Mocu settings
  - settings page
  - API key
  - provider
  - OpenRouter
  - custom gateway
  - model tiers
  - TTS
  - STT
  - embedding model
  - Perplexity search
  - Jev decision model
  - hybrid search
  - docs retrieval
---
# Mocu Settings

The **Settings** page in the sidebar controls how Mocu connects to AI providers and how its features behave. Settings are saved locally.

## Shared LLM gateway

Mocu is model-agnostic. Configure the shared gateway with:

- **Provider** — OpenRouter (the default) or a custom OpenAI-compatible gateway.
- **API key** — the key for the selected gateway.
- **Base URL** — the gateway endpoint. It defaults to the OpenRouter gateway URL; a custom provider requires its endpoint URL.

Any OpenAI-compatible endpoint can be used.

## Model tiers

Mocu uses separate models for different kinds of work. Set a model name for each tier:

- **Cheap** — fast, inexpensive work such as summaries, small decisions, and background memory tasks.
- **Medium** — balanced everyday work.
- **Expensive** — stronger reasoning for difficult tasks and the main agent.

You can also choose a specific model for an individual message in the chat input.

## Optional dedicated credentials

Some features can use their own API key instead of the shared gateway key:

- **Vision** — used by the desktop-vision tool to analyze screenshots.
- **Embedding** — used for memory and document-retrieval embeddings.
- **Perplexity** — used by the web search tool.

Leave a dedicated key empty to reuse the shared gateway key.

## Speech

- **TTS model and voice** — determine the model and voice Mocu uses for text-to-speech. The selected voice is also used by the Mocu avatar and spoken schedule reminders.
- **STT model** — used for speech-to-text when using voice input.

## Embedding

The **Embedding model** is used for memory retrieval and hybrid search over knowledge documents.

## Perplexity web search

- **Perplexity model** — selects the model used by the `perplexity_search` web search tool.
- **Search depth** — controls how deeply web searches go.

The tool uses the dedicated Perplexity credentials when configured, or falls back to the shared key.

## Decision (Jev) model

Mocu’s built-in probabilistic decision model, **Jev**, can be queried by the agent and extensions for typed choices and scores. It is used for tasks such as routing, tool selection, and re-ranking.

Settings include:

- **Decision API key** and **decision endpoint URL** — the endpoint is derived from the gateway by default and can be overridden.
- **Decision model** — the model Jev uses.

## Docs retrieval and hybrid search

These settings control how [knowledge docs](mocu-knowledge-docs.md) are retrieved before the agent answers:

- **BM25 weight** and **embedding weight** — balance keyword-based and semantic search.
- **Keyword weight** — controls the overall contribution of keyword matching.
- **Relevance threshold** — the minimum score for a document to be injected.
- **Result cap** — the maximum number of document references injected per answer.
- **Candidate depth** — the number of candidates considered before applying the result cap.
- **Jev enabled, weight, timeout, and candidate limit** — control whether and how Jev re-ranks document candidates.

## Related documents

- [Mocu User Guide](mocu-user-guide.md) — app overview
- [Mocu Knowledge Docs](mocu-knowledge-docs.md) — the knowledge-docs feature
- [Mocu Schedule](mocu-schedule.md) — schedule features, including spoken reminders that use the TTS voice
- [Mocu Built-in Tools Reference](mocu-tools-reference.md) — tools that depend on these settings

## When to use this document

Retrieve this document when a user asks how to configure Mocu, set an API key or provider, choose a model, adjust speech or vision options, configure Perplexity or Jev, or change document-retrieval and hybrid-search settings.
