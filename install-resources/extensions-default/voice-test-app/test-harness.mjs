// Test harness: simulates the Mocu host — sends extension.execute on stdin and
// also answers the extension's host API requests (mocu.tts.speak / mocu.stt.transcribe).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const command = process.argv[2] || "speak";
const inputArg = process.argv[3];
const input = inputArg ? JSON.parse(readFileSync(inputArg, "utf8").replace(/^\uFEFF/, "")) : { text: "Hello, this is a test." };

const child = spawn(process.execPath, ["index.js"], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });

let stdout = "";
let done = false;

function finish() {
  if (done) return;
  done = true;
  child.kill();
  process.exit(0);
}

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
  let idx;
  while ((idx = stdout.indexOf("\n")) >= 0) {
    const line = stdout.slice(0, idx).trim();
    stdout = stdout.slice(idx + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.error("UNPARSEABLE LINE:", line.slice(0, 300));
      continue;
    }

    // A host-API request from the extension -> answer it like the Mocu host would.
    if (message.method === "mocu.tts.speak") {
      const fakeAudio = Buffer.from("FAKE-TTS-AUDIO-" + message.params.text).toString("base64");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { audio: fakeAudio, mimeType: "audio/mpeg" } }) + "\n");
      continue;
    }
    if (message.method === "mocu.stt.transcribe") {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { text: "This is a sample speech recognition result." } }) + "\n");
      continue;
    }

    // The response to our extension.execute request.
    if (message.id === 1 && ("result" in message || "error" in message)) {
      const result = message.result || {};
      console.error("success:", result.success);
      if (result.success) {
        const out = result.output || {};
        if (typeof out.audio === "string") {
          console.error("audio length (base64 chars):", out.audio.length, "mimeType:", out.mimeType);
        } else if (typeof out.text === "string") {
          console.error("text:", out.text);
        }
      } else {
        console.error("error:", result.error);
      }
      finish();
    }
  }
});

child.stderr.on("data", (chunk) => process.stderr.write("[ext-stderr] " + chunk));
child.on("exit", () => finish());

const request = {
  jsonrpc: "2.0",
  id: 1,
  method: "extension.execute",
  params: { command, input, context: {}, config: {} },
};
child.stdin.write(JSON.stringify(request) + "\n");
