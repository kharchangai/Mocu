import { config as loadEnv } from "dotenv";
import { Client } from "ssh2";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing or empty environment variable: ${name}`);
  }
  return value;
}

try {
  const envResult = loadEnv({ path: resolve(scriptDir, ".env") });
  if (envResult.error) {
    throw new Error(`Could not read .env: ${envResult.error.message}`);
  }

  const host = requiredEnv("MY_SERVER_HOST");
  const username = requiredEnv("MY_SERVER_USER");
  const port = Number(process.env.SSH_PORT || 22);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SSH_PORT must be an integer between 1 and 65535.");
  }

  const options = {
    host,
    port,
    username,
    readyTimeout: 20_000,
  };

  const keyPath = process.env.SSH_PRIVATE_KEY_PATH?.trim();

  if (keyPath) {
    const fullKeyPath = isAbsolute(keyPath)
      ? keyPath
      : resolve(scriptDir, keyPath);

    options.privateKey = readFileSync(fullKeyPath);

    if (process.env.SSH_KEY_PASSPHRASE) {
      options.passphrase = process.env.SSH_KEY_PASSPHRASE;
    }
  } else {
    options.password = requiredEnv("MY_SERVER_PASSWORD");
  }

  console.log(`Connecting to ${host}:${port} as ${username}...`);

  const client = new Client();

  client.once("ready", () => {
    console.log("SSH connection successful.");
    client.end();
  });

  client.once("error", (error) => {
    console.error(`SSH connection failed: ${error.message}`);
    process.exitCode = 1;
  });

  client.connect(options);
} catch (error) {
  console.error(`Test failed: ${error.message}`);
  process.exitCode = 1;
}