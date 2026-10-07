---
id: typesafe-jev-latest
title: TypeSafe Jev Latest
description: Documentation for TypeSafe Jev Latest, TypeSafe’s flagship System
  One model, and its integration through OpenRouter’s Decisions API. Retrieve
  this document when an agent needs to understand Jev’s purpose, model slug,
  typed question primitives, confidence and probability outputs, request format,
  authentication, or decision-oriented integration patterns.
keywords:
  - TypeSafe Jev Latest
  - Jev 1.13
  - TypeSafe Jev
  - typesafe/jev-latest
  - System One
  - OpenRouter Decisions API
  - typed questions
  - structured decisions
  - noul
  - choice
  - score
  - calibrated probabilities
  - confidence
  - atomic questions
  - decision routing
---
# TypeSafe Jev Latest

## Documentation Index

The complete TypeSafe documentation index is available at:

<https://docs.typesafe.ai/llms.txt>

Use the index to discover all available documentation pages before exploring further.

## Model Overview

Jev is TypeSafe’s flagship model and the first **System One** model. The OpenRouter model slug is:

```text
~typesafe/jev-latest
```

This slug always redirects to the latest model in the Jev family. The displayed latest version is **Jev 1.13**.

Jev is designed for software-consumable decisions rather than conversational text generation:

- Send a `state` and a set of typed questions.
- Jev evaluates each question against the state.
- Receive typed answers, probability distributions, and—for `choice` and `score`—confidence values.
- Use the results directly in application code to branch, sort, rank, verify, classify, or route.
- The model does not generate ordinary text responses that an application must parse.

Large language models are generally designed to produce text for humans. Jev instead evaluates typed questions against application state and returns structured results directly, avoiding the pattern of prompting a text model, parsing its output, and trying to make the parsed result reliable.

The application owns the workflow and decides what to do with Jev’s answers. For broader development guidance, TypeSafe documentation refers to building with **System One**.

## TypeSafe Question Primitives

TypeSafe exposes three AI primitives. Each primitive asks a different type of question and returns a corresponding structured answer.

| Question type | Goal | Returns |
|---|---|---|
| `choice` | Choose an option from a list | `choice`, `probabilities`, `confidence` |
| `score` | Score the state on an ordered rubric | `score`, `probabilities`, `confidence` |
| `noul` | Determine whether a statement is true | `noul` value from 0 to 1 |

All three question types can be mixed in one API call.

Every question is evaluated independently, in parallel, and against the same state. Adding questions generally has little effect on response time, and additional questions do not create context-rot because each question is evaluated in isolation.

### `noul`

Use `noul` for a true/false judgment. It returns a value from `0` to `1` representing the probability of the statement being true.

```json
"is_urgent": {
  "type": "noul",
  "instructions": "Does this message convey urgency?",
  "criteria": {
    "true": "Explicitly time-sensitive",
    "false": "No urgency expressed"
  }
}
```

### `choice`

Use `choice` when the answer must be selected from named options defined by the application. The response includes the selected choice, probabilities, and confidence.

```json
"department": {
  "type": "choice",
  "instructions": "Which team should handle this?",
  "criteria": {
    "billing": "Payments, invoicing, refunds",
    "technical": "Bugs, outages, integrations",
    "sales": "Pricing, upgrades, new accounts"
  }
}
```

### `score`

Use `score` when the answer should be placed on an ordered rubric. The response includes the selected score, probabilities, and confidence.

```json
"frustration": {
  "type": "score",
  "instructions": "How frustrated is the customer?",
  "criteria": ["Calm", "Frustrated", "Very angry"]
}
```

## Atomic Questions and Composition

System One models work best when each question asks one specific, well-scoped thing: a judgment that a knowledgeable person could make in a few seconds given the relevant state.

If a desired judgment requires extended reasoning or combines multiple independent factors, decompose it into separate questions and combine the results in application code.

For example, instead of asking Jev to “rate this startup pitch,” ask separate questions about:

- Market size
- Technical feasibility
- Differentiation

The application can combine the resulting scores with its own formula. This keeps each evaluation focused and lets developers change weighting or priorities in code without rewriting a single complex prompt.

Suitable use cases include:

- Routing
- Ranking
- Verification
- Classification
- Filtering
- Prioritization
- Other structured decision workflows

## Decisions API

Use the OpenRouter Decisions API endpoint:

```text
POST https://openrouter.ai/api/alpha/decisions
```

Required headers:

```text
Authorization: Bearer $OPENROUTER_API_KEY
Content-Type: application/json
```

Optional OpenRouter-specific headers can be included:

- `HTTP-Referer`: the application’s site URL, used for OpenRouter rankings
- `X-Title`: the application’s site name, used for OpenRouter rankings

OpenRouter normalizes requests and responses across providers for this endpoint.

A request supplies:

- `model`: `~typesafe/jev-latest`
- `state`: a string, object, or array containing the information to evaluate
- `questions`: an object containing one or more typed questions

Each question defines its type, instructions, and criteria.

## Authentication

Create an API key in the OpenRouter dashboard and expose it through the `OPENROUTER_API_KEY` environment variable:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
```

## Complete cURL Example

The following request evaluates a customer message about failing payouts:

```bash
curl https://openrouter.ai/api/alpha/decisions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{
    "model": "~typesafe/jev-latest",
    "state": "Help! My payouts have been failing for 3 days.",
    "questions": {
      "is_urgent": {
        "type": "noul",
        "instructions": "Does this message convey urgency?",
        "criteria": {
          "true": "Explicitly time-sensitive",
          "false": "No urgency expressed"
        }
      },
      "department": {
        "type": "choice",
        "instructions": "Which team should handle this?",
        "criteria": {
          "billing": "Payments, invoicing, refunds",
          "technical": "Bugs, outages, integrations",
          "sales": "Pricing, upgrades, new accounts"
        }
      },
      "frustration": {
        "type": "score",
        "instructions": "How frustrated is the customer?",
        "criteria": ["Calm", "Frustrated", "Very angry"]
      }
    }
  }'
```

For this example, Jev evaluates all three questions in parallel against the same state:

- Whether the message is urgent
- Which department should handle it: billing, technical, or sales
- The customer’s frustration level on the ordered scale from Calm to Very angry

The application can then use the typed results, probabilities, and confidence values to route the message or determine the next action.

## SDK Compatibility

OpenRouter’s API is OpenAI-compatible, so most OpenAI-compatible SDKs can be used by changing the base URL and selecting the model slug:

```text
~typesafe/jev-latest
```

Examples are available for:

- TypeScript SDK
- Python
- TypeScript with `fetch`
- cURL

Third-party SDK and framework usage is covered separately in OpenRouter’s frameworks documentation.

## Important Constraints and Guidance

- Do not use Jev as a normal chat or text-generation model.
- Provide a state and explicitly defined typed questions.
- Define possible outcomes or rubric criteria in each request.
- Use `noul` for true/false probabilities.
- Use `choice` for application-defined options.
- Use `score` for ordered scales or rubrics.
- Keep questions atomic and focused on one judgment.
- Decompose multi-factor judgments into separate questions and combine their results in code.
- Questions in one request are evaluated independently, in parallel, and against the same state.
- `choice` and `score` provide confidence as well as probabilities; `noul` provides a value from `0` to `1`.
- The application, not the model, controls the workflow and acts on the resulting decisions.
- The supplied material identifies Jev 1.13 as the latest displayed version but does not specify pricing details.

## Further TypeSafe Documentation

Useful areas in the TypeSafe documentation include:

- **Quick Start**: immediate setup and first requests
- **AI Primer**: why TypeSafe trains models for calibrated decisions instead of generated text
- **Primitives**: how to define and combine Choice, Score, and Noul questions
- **Confidence**: how confidence is reported and how it can be used architecturally
- **Patterns**: common patterns for building systems with TypeSafe

## When to use this document

Retrieve this document when a user asks about TypeSafe Jev, Jev 1.13, the `~typesafe/jev-latest` model slug, System One, OpenRouter Decisions API authentication or request examples, typed decision primitives, `noul`, `choice`, `score`, probabilities, confidence, parallel question evaluation, or designing atomic structured questions for routing, ranking, classification, verification, or other software workflows.
