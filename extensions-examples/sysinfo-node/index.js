import os from "node:os";

import { createExtension } from "@mocu/extension-sdk";

/*
 * A test Mocu text extension built on the official Node.js SDK.
 *
 * It exposes a single "sysinfo" command that reports details about
 * the host operating system:
 *   - OS name / type (e.g. Windows_NT, Linux, Darwin)
 *   - OS version / release (e.g. 10.0.26100)
 *   - distribution name & version (where available, e.g. debian 12)
 *   - architecture and platform
 *   - hostname, uptime and CPU info
 */

// Map Node's os.type() to a friendlier platform name.
const OS_NAMES = {
  Windows_NT: "Windows",
  Linux: "Linux",
  Darwin: "macOS",
};

const readCpuModel = () => {
  const cpus = os.cpus();

  return cpus.length > 0 ? (cpus[0]?.model ?? null) : null;
};

const readOsRelease = () => {
  try {
    return os.release().split(".").length
      ? { pretty_name: `${os.type()} ${os.release()}` }
      : {};
  } catch {
    return {};
  }
};

const formatUptime = (seconds) => {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  return [days, hours, minutes]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
};

const extension = createExtension({
  commands: {
    // Called by Mocu whenever the user runs the "sysinfo" command.
    sysinfo() {
      const type = os.type();
      const release = os.release();
      const platform = os.platform();
      const arch = os.arch();
      const hostname = os.hostname();
      const cpuModel = readCpuModel();
      const osRelease = readOsRelease();

      const osName = OS_NAMES[type] ?? type;
      const prettyName = osRelease.pretty_name ?? `${osName} ${release}`;

      return [
        "SYSTEM INFORMATION",
        "==================",
        `OS name:          ${osName}`,
        `OS version:       ${release} (${platform} ${arch})`,
        `Pretty name:      ${prettyName}`,
        `Hostname:         ${hostname}`,
        `CPU:              ${cpuModel ?? "unknown"}`,
        `CPU cores:        ${os.cpus().length}`,
        `Total memory:     ${(os.totalmem() / 1024 ** 3).toFixed(2)} GB`,
        `Free memory:      ${(os.freemem() / 1024 ** 3).toFixed(2)} GB`,
        `Uptime:           ${formatUptime(os.uptime())}`,
      ].join("\n");
    },
  },
});

// Start listening for JSON-RPC messages from the Mocu host.
extension.start();
