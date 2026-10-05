import { createExtension } from "@mocu/extension-sdk";
import { config as loadEnv } from "dotenv";
import { Client } from "ssh2";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = dirname(fileURLToPath(import.meta.url));

function getEnvValue(config, configKey, { required = true } = {}) {
  const envName = String(config[configKey] ?? "").trim();
  if (!envName) {
    if (required) throw new Error(`Configuration ${configKey} is missing; specify the environment variable name.`);
    return undefined;
  }
  const value = process.env[envName];
  if (!value && required) throw new Error(`Environment variable ${envName} was not found in the .env file or is empty.`);
  return value;
}

function loadSshConfig(config) {
  const envFilePath = String(config.ENV_FILE_PATH ?? "").trim();
  loadEnv({ path: envFilePath ? resolve(envFilePath) : resolve(extensionDir, ".env") });

  const options = {
    host: getEnvValue(config, "SSH_HOST_ENV"),
    username: getEnvValue(config, "SSH_USERNAME_ENV"),
    port: Number(config.SSH_PORT ?? 22),
    readyTimeout: 20_000,
  };
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error("SSH_PORT must be an integer between 1 and 65535.");
  }

  const keyPath = String(config.SSH_PRIVATE_KEY_PATH ?? "").trim();
  if (keyPath) {
    const fullKeyPath = isAbsolute(keyPath) ? keyPath : resolve(extensionDir, keyPath);
    options.privateKey = readFileSync(fullKeyPath);
    const passphrase = getEnvValue(config, "SSH_KEY_PASSPHRASE_ENV", { required: false });
    if (passphrase) options.passphrase = passphrase;
  } else {
    options.password = getEnvValue(config, "SSH_PASSWORD_ENV");
  }
  return options;
}

function withSsh(config, operation) {
  const options = loadSshConfig(config);
  return new Promise((resolveResult, rejectResult) => {
    const client = new Client();
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      client.end();
      if (error) rejectResult(error);
      else resolveResult(result);
    };

    client.once("error", (error) => finish(error));
    client.once("ready", () => {
      Promise.resolve().then(() => operation(client)).then(
        (result) => finish(null, result),
        (error) => finish(error),
      );
    });
    try {
      client.connect(options);
    } catch (error) {
      finish(error);
    }
  });
}

function runSsh(config, command) {
  return withSsh(config, (client) => new Promise((resolveCommand, rejectCommand) => {
    client.exec(command, (error, stream) => {
      if (error) return rejectCommand(error);
      let stdout = "";
      let stderr = "";
      stream.on("data", (chunk) => { stdout += chunk.toString(); });
      stream.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      stream.once("error", rejectCommand);
      stream.once("close", (code, signal) => {
        resolveCommand({ stdout, stderr, code, signal: signal ?? null });
      });
    });
  }));
}

function getTransferPaths(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Input must include localPath and remotePath.");
  }
  const localPathInput = typeof input.localPath === "string" ? input.localPath.trim() : "";
  const remotePath = typeof input.remotePath === "string" ? input.remotePath.trim() : "";
  if (!localPathInput || !remotePath || remotePath.includes("\0") || localPathInput.includes("\0")) {
    throw new Error("Both localPath and remotePath must be non-empty paths.");
  }
  if (!isAbsolute(localPathInput)) throw new Error("localPath must be an absolute path on this computer.");
  if (input.overwrite !== undefined && typeof input.overwrite !== "boolean") {
    throw new Error("overwrite must be true or false when provided.");
  }
  return { localPath: resolve(localPathInput), remotePath, overwrite: input.overwrite === true };
}

function transferFile(config, input, direction) {
  const { localPath, remotePath, overwrite } = getTransferPaths(input);

  if (direction === "upload") {
    let fileStat;
    try {
      fileStat = statSync(localPath);
    } catch (error) {
      throw new Error(`Cannot access local source file: ${error.message}`);
    }
    if (!fileStat.isFile()) throw new Error("localPath must point to a regular file.");

    return withSsh(config, (client) => new Promise((resolveTransfer, rejectTransfer) => {
      client.sftp((error, sftp) => {
        if (error) return rejectTransfer(error);
        sftp.stat(remotePath, (statError) => {
          if (!statError && !overwrite) {
            return rejectTransfer(new Error("Remote destination already exists; set overwrite: true to replace it."));
          }
          if (statError && statError.code !== 2 && statError.code !== "ENOENT") return rejectTransfer(statError);
          sftp.fastPut(localPath, remotePath, (transferError) => {
            if (transferError) return rejectTransfer(transferError);
            resolveTransfer({ success: true, direction, localPath, remotePath, bytes: fileStat.size });
          });
        });
      });
    }));
  }

  if (existsSync(localPath) && !overwrite) {
    throw new Error("Local destination already exists; set overwrite: true to replace it.");
  }
  if (existsSync(localPath) && !statSync(localPath).isFile()) {
    throw new Error("localPath exists and is not a regular file.");
  }

  return withSsh(config, (client) => new Promise((resolveTransfer, rejectTransfer) => {
    client.sftp((error, sftp) => {
      if (error) return rejectTransfer(error);
      sftp.fastGet(remotePath, localPath, (transferError) => {
        if (transferError) return rejectTransfer(transferError);
        try {
          resolveTransfer({ success: true, direction, localPath, remotePath, bytes: statSync(localPath).size });
        } catch (statError) {
          rejectTransfer(statError);
        }
      });
    });
  }));
}

const extension = createExtension({
  commands: {
    async ssh(input, _context, config) {
      const command = typeof input === "string" ? input : input?.command;
      if (typeof command !== "string" || !command.trim()) {
        throw new Error("The command input must include command.");
      }
      return await runSsh(config, command);
    },
    async ssh_upload(input, _context, config) {
      return await transferFile(config, input, "upload");
    },
    async ssh_download(input, _context, config) {
      return await transferFile(config, input, "download");
    },
  },
});

extension.start();
