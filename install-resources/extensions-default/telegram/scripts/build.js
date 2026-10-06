import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stageDir = await mkdtemp(join(tmpdir(), "mocu-telegram-"));
const archivePath = join(projectDir, "Telegram-Bridge.zip");
const files = ["manifest.json", "index.js", "package.json", "README.md", "vendor"];

try {
  for (const file of files) {
    await cp(join(projectDir, file), join(stageDir, file), { recursive: true });
  }

  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const command = [
    `$source = ${quote(stageDir)}`,
    `$destination = ${quote(archivePath)}`,
    "Compress-Archive -Path (Join-Path $source '*') -DestinationPath $destination -CompressionLevel Optimal -Force",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`PowerShell ZIP creation failed (exit ${result.status}).`);

  console.log(`Created ${archivePath}`);
} finally {
  await rm(stageDir, { recursive: true, force: true });
}
