# Voice Test App — Mocu extension for speech-to-text and text-to-speech testing

A Mocu extension with a built-in App UI that:

1. Records the user's voice via the microphone when a button is clicked (`MediaRecorder`).
2. Converts the recorded audio to base64 and sends it to the backend `transcribe` command.
3. The backend (Node.js) converts it to text using `extension.speech.transcribe` (the STT model configured in Mocu) and the text is shown in the UI.
4. The user can edit the text and press the "Play Text" button to convert the same text back to speech using `extension.speech.speak` (the Mocu TTS model) and play it.

## Structure

```
voice-test-app/
├── manifest.json            # Extension with two commands (transcribe, speak) + app UI
├── package.json             # SDK dependency as file:./vendor/extension-sdk
├── index.js                 # Node backend: the two STT/TTS commands
├── test-harness.mjs         # Test harness (simulates the Mocu host) — not required at install time
├── ui/
│   ├── index.html           # English LTR UI: record, show text, play
│   └── vendor/mocu-ui.js    # Mocu browser SDK (vendored)
└── vendor/
    ├── extension-sdk/       # Mocu Node SDK (vendored)
    └── extension-contracts/ # contracts package (vendored)
```

## Installing in Mocu

1. Mocu **Extensions** page → **Install from Folder** → select the `voice-test-app` folder.
2. After installation, open the **App** page in the Mocu sidebar and select "Voice Test App".
3. The first time, the browser will ask for microphone access; allow it.

## Requirements

- Node.js version 20 or later (required by the Mocu SDK).
- The STT and TTS models must be configured in **Mocu Settings** (gateway, API key, models, and voice). The extension does not need a separate API key.

## Limits

- Up to ~30 MB of raw audio (40 million base64 characters) per STT request.
- Up to 20,000 characters of text per TTS request.
- Long recordings are not recommended; a few sentences are enough for testing.

## Testing

With the test harness (simulated host):

```powershell
node test-harness.mjs speak test-input.json          # text -> audio
node test-harness.mjs transcribe test-input-stt.json # audio (base64) -> text
```

Both paths were tested successfully.
