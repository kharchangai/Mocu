import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const extensionPath = new URL("../index.js", import.meta.url);
const child = spawn(process.execPath, [fileURLToPath(extensionPath)], {
  stdio: ["pipe", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for extension. stderr: ${stderr}`)), 5000);
    const checkOutput = () => {
      const line = stdout.split("\n").find((item) => item.includes('"id":"smoke"'));
      if (!line) return;
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    };
    child.stdout.on("data", checkOutput);
    checkOutput();
  });

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: "smoke",
    method: "extension.execute",
    params: { command: "bot_status", input: {}, config: {} },
  })}\n`);

  const message = await response;
  assert.equal(message.result?.success, true, JSON.stringify(message));
  assert.deepEqual(message.result.output, {
    running: false,
    allowedChatId: null,
    note: "The bot token is never included in status output.",
  });
  console.log("Telegram Bridge JSON-RPC smoke test passed.");
} finally {
  child.kill();
}
