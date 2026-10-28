# Privacy Policy — Mocu

**Last updated:** 28 October 2026

Mocu is a desktop application. It runs entirely on your own computer. This page lists every
case in which the app sends data outside your machine. There is no hidden category beyond
the ones below.

## 1. What stays on your computer

Everything you create in Mocu is stored locally in the application's data folder on your
device and is never uploaded by the app itself:

- Projects, chats, and conversation history
- Personal and project memory
- Knowledge documents, notes, and schedules
- Saved agents, skills, and extensions
- Application settings

There is **no Mocu account**, no sign-up, and no Mocu-operated server that receives your content.

## 2. No telemetry, no analytics

Mocu contains no analytics, crash-reporting, or usage-tracking code. The app does not send
usage statistics, device identifiers, or crash dumps to the Mocu project or to any third party.

## 3. Model providers (the only place your prompts go)

To generate a response, Mocu sends your request to the AI model provider **that you configure
in Settings**, using **your own API key**:

- By default this is OpenRouter (`openrouter.ai`), or
- any OpenAI-compatible gateway URL or local model server that you enter yourself.

The content of a request can include your prompt, the conversation context Mocu selects for
that request, and any files or documents you attach or ask Mocu to read. That content is
handled under the privacy policy of the provider you chose. If you use a local model server,
data does not leave your machine.

Extension tools you install may contact the third-party services they are built for. Each
extension's own documentation describes what it sends.

## 4. Update checks

Mocu checks for new versions through the public GitHub Releases API for this repository
(`github.com/kharchangai/Mocu`). The request contains no personal data and no identifiers
beyond what any ordinary web request includes.

## 5. Links you open yourself

Mocu opens web pages only when you click a link or follow a documentation reference. Those
pages are governed by their own policies.

## 6. Children

Mocu is a general-purpose productivity tool and is not directed at children.

## 7. Changes and contact

This policy may be updated to reflect new features; the date at the top always shows the
current version. Questions or concerns can be raised in the project's issue tracker:

https://github.com/kharchangai/Mocu/issues