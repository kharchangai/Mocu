import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Command } from "@tauri-apps/plugin-shell";

export interface TerminalExecutionToolOptions {
  /**
   * Optional project directory.
   * When provided, commands start inside this directory.
   */
  projectPath?: string;

  /**
   * Maximum number of characters returned from stdout and stderr.
   */
  maxOutputLength?: number;

  /**
   * Maximum command execution time in milliseconds.
   */
  timeoutMs?: number;
}

type OperatingSystemName = "windows" | "macos" | "linux" | "unknown";

type OperatingSystemInfo = {
  name: OperatingSystemName;
  displayName: string;
  commandEnvironment: string;
  shell: "powershell" | "sh";
  shellDescription: string;
  pathSeparator: "\\" | "/";
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
};

type ExecutionResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

const DEFAULT_MAX_OUTPUT_LENGTH = 100_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Detect the user's operating system from the WebView environment.
 *
 * In a Tauri desktop application, navigator.userAgent and
 * navigator.userAgentData.platform describe the host operating system.
 *
 * Detection is performed before creating the tool so that the operating
 * system can be included in the tool description and schema that the
 * main agent sees during tool selection.
 */
function detectOperatingSystem(): OperatingSystemInfo {
  if (typeof navigator === "undefined") {
    return {
      name: "unknown",
      displayName: "Unknown Unix-like operating system",
      commandEnvironment: "POSIX-compatible shell",
      shell: "sh",
      shellDescription: "POSIX sh",
      pathSeparator: "/",
      isWindows: false,
      isMacOS: false,
      isLinux: false,
    };
  }

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  const userAgent = navigator.userAgent?.toLowerCase() ?? "";
  const navigatorPlatform = navigator.platform?.toLowerCase() ?? "";
  const userAgentDataPlatform =
    navigatorWithUserAgentData.userAgentData?.platform?.toLowerCase() ?? "";

  const combinedPlatformInformation = [
    userAgent,
    navigatorPlatform,
    userAgentDataPlatform,
  ].join(" ");

  const isWindows =
    combinedPlatformInformation.includes("windows") ||
    combinedPlatformInformation.includes("win32") ||
    combinedPlatformInformation.includes("win64");

  if (isWindows) {
    return {
      name: "windows",
      displayName: "Microsoft Windows",
      commandEnvironment: "Windows PowerShell",
      shell: "powershell",
      shellDescription: "PowerShell",
      pathSeparator: "\\",
      isWindows: true,
      isMacOS: false,
      isLinux: false,
    };
  }

  const isMacOS =
    combinedPlatformInformation.includes("macintosh") ||
    combinedPlatformInformation.includes("mac os") ||
    combinedPlatformInformation.includes("macos") ||
    combinedPlatformInformation.includes("darwin") ||
    combinedPlatformInformation.includes("macintel");

  if (isMacOS) {
    return {
      name: "macos",
      displayName: "Apple macOS",
      commandEnvironment: "POSIX shell on macOS",
      shell: "sh",
      shellDescription: "POSIX sh",
      pathSeparator: "/",
      isWindows: false,
      isMacOS: true,
      isLinux: false,
    };
  }

  const isLinux =
    combinedPlatformInformation.includes("linux") ||
    combinedPlatformInformation.includes("x11") ||
    combinedPlatformInformation.includes("ubuntu") ||
    combinedPlatformInformation.includes("debian") ||
    combinedPlatformInformation.includes("fedora");

  if (isLinux) {
    return {
      name: "linux",
      displayName: "Linux",
      commandEnvironment: "POSIX shell on Linux",
      shell: "sh",
      shellDescription: "POSIX sh",
      pathSeparator: "/",
      isWindows: false,
      isMacOS: false,
      isLinux: true,
    };
  }

  return {
    name: "unknown",
    displayName: "Unknown Unix-like operating system",
    commandEnvironment: "POSIX-compatible shell",
    shell: "sh",
    shellDescription: "POSIX sh",
    pathSeparator: "/",
    isWindows: false,
    isMacOS: false,
    isLinux: false,
  };
}

function normalizeCommand(command: string): string {
  return command.replace(/\0/g, "").trim();
}

function truncateOutput(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) {
    return value;
  }

  const removedCharacters = value.length - maximumLength;

  return `${value.slice(
    0,
    maximumLength
  )}\n\n[OUTPUT_TRUNCATED: ${removedCharacters} characters were omitted.]`;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * This local check is intentionally narrow.
 *
 * Normal development commands are allowed. It blocks only commands that
 * clearly attempt catastrophic deletion, disk destruction, critical system
 * modification, security bypass, or credential extraction.
 *
 * This is a defense-in-depth check that runs entirely locally, without any
 * model involvement, before a command is executed.
 */
function getHardBlockReason(
  command: string,
  operatingSystem: OperatingSystemInfo
): string | null {
  const normalized = command
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return "The command is empty.";
  }

  if (command.includes("\0")) {
    return "The command contains an invalid null byte.";
  }

  if (operatingSystem.isWindows) {
    const blockedWindowsPatterns: Array<{
      pattern: RegExp;
      reason: string;
    }> = [
      {
        pattern:
          /\b(format|format-volume|clear-disk|initialize-disk)\b/i,
        reason:
          "Formatting, clearing, or reinitializing a physical disk is blocked.",
      },
      {
        pattern: /\b(remove-partition|delete\s+partition)\b/i,
        reason: "Deleting disk partitions is blocked.",
      },
      {
        pattern:
          /\b(remove-item|del|erase|rd|rmdir)\b[^;&|]*(?:[a-z]:\\windows|[a-z]:\\programdata|[a-z]:\\program files|[a-z]:\\program files \(x86\))/i,
        reason:
          "Deleting protected Windows system or application directories is blocked.",
      },
      {
        pattern:
          /\b(remove-item|del|erase|rd|rmdir)\b[^;&|]*(?:[a-z]:\\users\\[^\\]+\\appdata)(?:\\|\s|["']|$)/i,
        reason:
          "Deleting a user's complete application-data directory is blocked.",
      },
      {
        pattern:
          /\b(remove-item|del|erase|rd|rmdir)\b[^;&|]*["']?[a-z]:\\["']?\s*[^;&|]*(?:\/s|\/q|-recurse|-force)/i,
        reason: "Recursive deletion of an entire drive root is blocked.",
      },
      {
        pattern:
          /\b(reg\s+(?:add|delete)|remove-itemproperty|set-itemproperty)\b[^;&|]*(?:hklm|hkey_local_machine|hkey_classes_root)/i,
        reason:
          "Modification of protected machine-wide registry areas is blocked.",
      },
      {
        pattern:
          /\b(shutdown|restart-computer|stop-computer)\b/i,
        reason:
          "Shutting down or restarting the operating system is blocked.",
      },
      {
        pattern:
          /\b(stop-process|taskkill)\b[^;&|]*(?:lsass|csrss|wininit|services|smss|winlogon|system)\b/i,
        reason: "Terminating a critical Windows process is blocked.",
      },
      {
        pattern:
          /\b(vssadmin\s+delete\s+shadows|wbadmin\s+delete|bcdedit\s+\/delete)\b/i,
        reason:
          "Deleting recovery data or boot configuration is blocked.",
      },
      {
        pattern:
          /\b(netsh\s+advfirewall\s+set\s+allprofiles\s+state\s+off|set-mppreference\s+-disablerealtimemonitoring\s+\$true)\b/i,
        reason:
          "Disabling operating-system security controls is blocked.",
      },
      {
        pattern:
          /\b(mimikatz|sekurlsa|procdump)\b[^;&|]*(?:lsass|logonpasswords)/i,
        reason:
          "Credential extraction from operating-system processes is blocked.",
      },
    ];

    for (const rule of blockedWindowsPatterns) {
      if (rule.pattern.test(normalized)) {
        return rule.reason;
      }
    }

    return null;
  }

  const blockedPosixPatterns: Array<{
    pattern: RegExp;
    reason: string;
  }> = [
    {
      pattern:
        /\brm\b[^;&|]*(?:-[a-z]*r[a-z]*f|-{1,2}recursive[^;&|]*-{1,2}force|-{1,2}force[^;&|]*-{1,2}recursive)[^;&|]*(?:\/|\/\*)\s*(?:[;&|]|$)/i,
      reason:
        "Recursive forced deletion of the filesystem root is blocked.",
    },
    {
      pattern:
        /\brm\b[^;&|]*(?:-[a-z]*r[a-z]*f|-{1,2}recursive)[^;&|]*(?:\/etc|\/usr|\/bin|\/sbin|\/boot|\/system|\/library|\/private|\/var\/db)(?:\/|\s|[;&|]|$)/i,
      reason:
        "Recursive deletion of critical operating-system directories is blocked.",
    },
    {
      pattern:
        /\b(?:find|xargs)\b[^;&|]*(?:\/etc|\/usr|\/bin|\/sbin|\/boot|\/system|\/library|\/private|\/var\/db)[^;&|]*(?:-delete|\brm\b)/i,
      reason:
        "Bulk deletion inside a critical operating-system directory is blocked.",
    },
    {
      pattern:
        /\b(?:mkfs(?:\.[a-z0-9]+)?|fdisk|parted|diskutil\s+(?:erase|partition)|dd)\b[^;&|]*(?:\/dev\/|physicaldrive)/i,
      reason:
        "Formatting, partitioning, or overwriting a physical disk is blocked.",
    },
    {
      pattern:
        /\bdd\b[^;&|]*\bof\s*=\s*\/dev\/(?:sd[a-z]|nvme\d+n\d+|disk\d+|rdisk\d+)/i,
      reason: "Raw writes to a physical disk are blocked.",
    },
    {
      pattern:
        />{1,2}\s*\/(?:etc\/(?:passwd|shadow|sudoers)|boot\/|system\/|library\/|private\/etc\/)/i,
      reason:
        "Overwriting a critical operating-system file is blocked.",
    },
    {
      pattern:
        /\b(?:chmod|chown|chgrp)\b[^;&|]*(?:\/etc\/(?:passwd|shadow|sudoers)|\/system\/|\/boot\/)/i,
      reason:
        "Changing permissions or ownership of critical system files is blocked.",
    },
    {
      pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/i,
      reason:
        "Shutting down or restarting the operating system is blocked.",
    },
    {
      pattern:
        /\bkill(?:all)?\b[^;&|]*(?:launchd|systemd|init|kernel_task)\b/i,
      reason:
        "Terminating a critical operating-system process is blocked.",
    },
    {
      pattern:
        /\b(?:csrutil\s+disable|spctl\s+--master-disable|systemctl\s+disable\s+(?:firewalld|ufw)|ufw\s+disable)\b/i,
      reason:
        "Disabling operating-system security controls is blocked.",
    },
    {
      pattern:
        /\b(?:cat|grep|awk|sed|cp|curl|wget)\b[^;&|]*(?:\/etc\/shadow|\/etc\/sudoers|\.ssh\/id_(?:rsa|ed25519)|keychain)[^;&|]*(?:https?:\/\/|nc\b|netcat\b|curl\b|wget\b)/i,
      reason:
        "Reading and transmitting credentials or protected secrets is blocked.",
    },
  ];

  for (const rule of blockedPosixPatterns) {
    if (rule.pattern.test(normalized)) {
      return rule.reason;
    }
  }

  return null;
}

async function executeWithTimeout(
  command: Command<string>,
  timeoutMs: number
): Promise<ExecutionResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      command.execute(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `Command execution exceeded the ${timeoutMs}ms time limit.`
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Creates the terminal execution tool used exclusively by the main agents.
 *
 * The tool receives an exact command from the calling agent and executes it
 * directly. No additional model is consulted: safety is enforced through the
 * local hard-block check before execution.
 */
export const terminalExecutionTool = (
  options: TerminalExecutionToolOptions = {}
) => {
  const {
    projectPath,
    maxOutputLength = DEFAULT_MAX_OUTPUT_LENGTH,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  /*
   * Detect the OS before defining the tool.
   *
   * This makes the OS available not only while executing the tool, but also
   * in the tool description and input schema that the main agent sees during
   * tool selection.
   */
  const operatingSystem = detectOperatingSystem();

  const executionContext = projectPath
    ? `Commands start inside the selected project directory: ${projectPath}`
    : "Commands start in the application's current working directory.";

  const toolDescription = [
    `Execute a single terminal command on ${operatingSystem.displayName}.`,
    `The command environment is ${operatingSystem.commandEnvironment}.`,
    executionContext,
    "This tool allows normal file operations, project-local deletion, Git, package managers, scripts, builds, tests, network requests, and developer tools.",
    "It blocks only destructive system-file deletion, disk destruction, critical operating-system modification, credential theft, and clearly malicious actions.",
    `All commands must be compatible with ${operatingSystem.shellDescription} on ${operatingSystem.displayName}.`,
  ].join(" ");

  return tool(
    async ({ command }) => {
      const commandToRun = normalizeCommand(command);

      if (!commandToRun) {
        return "INVALID_COMMAND: Terminal command cannot be empty.";
      }

      console.log(
        `[Terminal Tool] Received command: ${JSON.stringify(commandToRun)}`
      );
      console.log(
        `[Terminal Tool] Operating system: ${operatingSystem.displayName}`
      );
      console.log(
        `[Terminal Tool] Command environment: ${operatingSystem.commandEnvironment}`
      );

      const hardBlockReason = getHardBlockReason(
        commandToRun,
        operatingSystem
      );

      if (hardBlockReason) {
        console.warn(
          `[Terminal Tool] Command blocked by local protection: ${hardBlockReason}`
        );

        return `SECURITY_BLOCKED: ${hardBlockReason}`;
      }

      try {
        console.log(
          `[Terminal Tool] Executing ${operatingSystem.commandEnvironment} command: ${JSON.stringify(
            commandToRun
          )}`
        );

        const args = operatingSystem.isWindows
          ? [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-Command",
              commandToRun,
            ]
          : ["-c", commandToRun];

        const commandOptions = projectPath
          ? {
              cwd: projectPath,
            }
          : undefined;

        const shellCommand = Command.create(
          operatingSystem.shell,
          args,
          commandOptions
        );

        const executionResult = await executeWithTimeout(
          shellCommand,
          timeoutMs
        );

        const stdout = truncateOutput(
          executionResult.stdout ?? "",
          maxOutputLength
        );

        const stderr = truncateOutput(
          executionResult.stderr ?? "",
          maxOutputLength
        );

        if (executionResult.code !== 0) {
          console.error(
            `[Terminal Tool] Command failed with exit code ${executionResult.code}.`
          );

          return [
            "EXECUTION_FAILED",
            `Operating system: ${operatingSystem.displayName}`,
            `Shell: ${operatingSystem.shellDescription}`,
            `Exit code: ${executionResult.code ?? "unknown"}`,
            stdout ? `Standard output:\n${stdout}` : "",
            stderr ? `Error output:\n${stderr}` : "",
          ]
            .filter(Boolean)
            .join("\n\n");
        }

        console.log(
          "[Terminal Tool] Command executed successfully."
        );

        if (stdout && stderr) {
          return [
            "Command executed successfully.",
            `Operating system: ${operatingSystem.displayName}`,
            `Output:\n${stdout}`,
            `Warnings:\n${stderr}`,
          ].join("\n\n");
        }

        if (stdout) {
          return stdout;
        }

        if (stderr) {
          return `Command executed successfully with warnings:\n${stderr}`;
        }

        return "Command executed successfully with no output.";
      } catch (error) {
        const message = formatUnknownError(error);

        console.error(
          "[Terminal Tool] Execution error:",
          error
        );

        return `SYSTEM_ERROR: Failed to execute the terminal command on ${operatingSystem.displayName}. ${message}`;
      }
    },
    {
      name: "terminal_executor",
      description: toolDescription,
      schema: z.object({
        command: z
          .string()
          .min(1)
          .describe(
            [
              "The exact single-line command to execute in the terminal.",
              `The user's operating system is ${operatingSystem.displayName}.`,
              `Commands must be compatible with ${operatingSystem.commandEnvironment}.`,
              `Use ${operatingSystem.pathSeparator} as the native path separator when providing platform-specific paths.`,
            ].join(" ")
          ),
      }),
    }
  );
};
