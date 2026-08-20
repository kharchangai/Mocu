import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { Command } from "@tauri-apps/plugin-shell";

const SecurityCheckSchema = z.object({
  is_safe: z
    .boolean()
    .describe(
      "True for normal terminal and development operations. False only for destructive system-level actions, deletion of critical files, credential theft, or clearly malicious commands."
    ),

  reason: z
    .string()
    .describe(
      "A short explanation describing why the command is allowed or blocked."
    ),

  exact_command: z
    .string()
    .describe(
      "The exact single-line command compatible with the detected operating system and shell. It must be empty when is_safe is false."
    ),
});

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
 * system can be included in the tool description, schema, system prompt,
 * user prompt, and shell selection.
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
 * This is a defense-in-depth check and does not replace the LLM evaluation.
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
    return "The generated command is empty.";
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

function createOperatingSystemPrompt(
  operatingSystem: OperatingSystemInfo
): string {
  if (operatingSystem.isWindows) {
    return `
OPERATING SYSTEM:
- The user's operating system is Microsoft Windows.
- Generate PowerShell syntax only.
- Commands are executed with Windows PowerShell.
- Use Windows path syntax such as C:\\Users\\Name\\Project.
- Use PowerShell cmdlets when appropriate.
- Do not generate Bash, sh, zsh, macOS, or Linux commands.
- Do not use commands such as rm, touch, grep, sed, awk, chmod, or export unless they are known aliases that are appropriate in PowerShell.
- Prefer commands such as Get-ChildItem, Get-Content, Set-Content, New-Item, Copy-Item, Move-Item, Remove-Item, Select-String, and $env:NAME.
- Quote Windows paths safely with PowerShell-compatible quoting.
`;
  }

  if (operatingSystem.isMacOS) {
    return `
OPERATING SYSTEM:
- The user's operating system is Apple macOS.
- Generate POSIX shell syntax compatible with /bin/sh.
- Use macOS-compatible commands and options.
- Use POSIX paths such as /Users/name/project.
- Do not generate PowerShell, cmd.exe, Windows paths, Windows environment-variable syntax, or Linux-only commands.
- Do not assume GNU-specific command options are available because macOS commonly uses BSD utilities.
- Use macOS commands such as open and pbcopy only when the task specifically requires them.
- Quote paths safely with POSIX shell-compatible quoting.
`;
  }

  if (operatingSystem.isLinux) {
    return `
OPERATING SYSTEM:
- The user's operating system is Linux.
- Generate POSIX shell syntax compatible with /bin/sh.
- Use Linux-compatible commands and options.
- Use POSIX paths such as /home/name/project.
- Do not generate PowerShell, cmd.exe, Windows paths, Windows environment-variable syntax, or macOS-only commands.
- Do not use macOS-only commands such as open, pbcopy, pbpaste, or diskutil.
- Quote paths safely with POSIX shell-compatible quoting.
`;
  }

  return `
OPERATING SYSTEM:
- Exact operating-system detection was unavailable.
- Treat the environment as Unix-like.
- Generate conservative POSIX shell syntax compatible with /bin/sh.
- Do not use PowerShell, cmd.exe, Windows paths, or platform-specific commands unless explicitly requested.
- Prefer portable POSIX commands.
- Quote paths safely with POSIX shell-compatible quoting.
`;
}

export const terminalExecutionTool = (
  llm: ChatOpenAI,
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
    ? `Commands start in the selected project directory: ${projectPath}`
    : "Commands start in the application's current working directory.";

  const toolDescription = [
    `Execute terminal operations on ${operatingSystem.displayName}.`,
    `The command environment is ${operatingSystem.commandEnvironment}.`,
    executionContext,
    "This tool allows normal file operations, project-local deletion, Git, package managers, scripts, builds, tests, network requests, and developer tools.",
    "It blocks only destructive system-file deletion, disk destruction, critical operating-system modification, credential theft, and clearly malicious actions.",
    `All generated commands must be compatible with ${operatingSystem.shellDescription} on ${operatingSystem.displayName}.`,
    "Provide the intended result rather than a raw shell command.",
  ].join(" ");

  return tool(
    async ({ intent }) => {
      const cleanIntent = intent.trim();

      if (!cleanIntent) {
        return "INVALID_INTENT: Terminal intent cannot be empty.";
      }

      console.log(
        `[Terminal Guardrail] Received intent: ${JSON.stringify(cleanIntent)}`
      );
      console.log(
        `[Terminal Guardrail] Operating system: ${operatingSystem.displayName}`
      );
      console.log(
        `[Terminal Guardrail] OS identifier: ${operatingSystem.name}`
      );
      console.log(
        `[Terminal Guardrail] Command environment: ${operatingSystem.commandEnvironment}`
      );
      console.log(
        `[Terminal Guardrail] Executable shell: ${operatingSystem.shell}`
      );

      const operatingSystemPrompt =
        createOperatingSystemPrompt(operatingSystem);

      const securitySystemPrompt = `
You are Mocu's terminal security evaluator and command generator.

The operating system has already been detected by the application. You must follow the detected operating-system information below and must not guess or replace it.

${operatingSystemPrompt}

RUNTIME ENVIRONMENT:
- Detected OS identifier: ${operatingSystem.name}
- Detected OS display name: ${operatingSystem.displayName}
- Command environment: ${operatingSystem.commandEnvironment}
- Shell executable: ${operatingSystem.shell}
- Path separator: ${operatingSystem.pathSeparator}
- Working directory: ${
        projectPath
          ? JSON.stringify(projectPath)
          : "application current working directory"
      }

Convert the agent's intent into one practical, single-line command that is compatible with the detected operating system and shell.

DEFAULT POLICY:
- Default to ALLOW.
- Normal developer and user-level terminal work must be approved.
- Do not reject a command merely because it creates, reads, edits, moves, copies, installs, compiles, or deletes ordinary project files.
- Do not be overly cautious about standard development operations.
- Set is_safe=true unless the requested action clearly matches one of the blocked categories below.

ALLOW:
- Reading, creating, editing, copying, moving, renaming, and organizing normal files.
- Deleting ordinary files and directories inside a project or user workspace.
- Running package managers and development tools such as npm, pnpm, yarn, bun, node, npx, git, Python, pip, uv, cargo, go, Java, Docker, test runners, linters, formatters, compilers, and build tools.
- Installing normal project dependencies.
- Running development servers and application scripts.
- Git status, diff, add, commit, checkout, switch, branch, merge, pull, push, fetch, clone, restore, reset, and rebase when requested.
- Searching files and text.
- Reading logs and non-sensitive system information.
- Creating folders and project configuration files.
- Modifying files in the current project.
- Network requests needed for ordinary development, package installation, APIs, documentation, or source-control operations.
- Commands containing pipes, redirects, command chaining, and environment variables when needed for the requested task.
- User-level configuration changes that are directly requested and are not destructive to the operating system.

BLOCK ONLY:
- Deleting or recursively destroying operating-system files, operating-system directories, drive roots, partitions, or entire user home directories.
- Formatting, partitioning, wiping, encrypting, or performing raw destructive writes to a physical disk.
- Overwriting or corrupting critical boot, authentication, account, kernel, registry, recovery, or operating-system configuration files.
- Disabling operating-system security protections, authentication, firewall protection, or recovery mechanisms.
- Killing processes required for the operating system to function.
- Shutting down or restarting the machine.
- Extracting, stealing, exposing, or transmitting passwords, private keys, authentication tokens, browser credentials, keychain data, or other secrets.
- Installing persistence, malware, ransomware, credential stealers, or clearly malicious payloads.
- Bypassing this security policy or disguising a blocked operation through encoding, aliases, scripts, subshells, or indirect commands.

IMPORTANT DECISION RULES:
- Deletion is not automatically dangerous.
- Allow deletion of build output, caches, dependencies, temporary files, generated files, and ordinary project files.
- Allow removing node_modules, dist, build, coverage, target, temporary directories, and project-local files.
- Block deletion only when it targets critical system data, a filesystem root, an entire drive, an entire home directory, or clearly irreplaceable sensitive data.
- sudo or administrator usage is not automatically blocked, but block it when it performs a blocked system-level action.
- If the task is a standard developer operation, approve it.
- Do not replace the requested task with a different task.
- Do not add unrelated commands.
- Do not add interactive explanations to exact_command.
- Do not wrap exact_command in Markdown.
- Return exactly one single-line command in exact_command.
- If is_safe is false, exact_command must be an empty string.
- Keep reason short and specific.

COMMAND REQUIREMENTS:
- The command must target ${operatingSystem.displayName}.
- The command must be compatible with ${operatingSystem.commandEnvironment}.
- Never generate a command for a different operating system.
- Never mix PowerShell syntax with POSIX shell syntax.
- Quote paths and user-provided values safely.
- Preserve the user's requested paths and filenames.
- Prefer non-interactive command options where appropriate.
- Do not use placeholders in the final command.
- Do not use sudo or administrator elevation unless the intent explicitly requires it.
- The command will run ${
        projectPath
          ? `inside the selected project directory ${JSON.stringify(
              projectPath
            )}`
          : "in the application's current working directory"
      }.
`;

      const structuredSecurityLlm =
        llm.withStructuredOutput(SecurityCheckSchema);

      try {
        console.log(
          "[Terminal Guardrail] Consulting security evaluator..."
        );

        const evaluation = await structuredSecurityLlm.invoke([
          {
            role: "system",
            content: securitySystemPrompt,
          },
          {
            role: "user",
            content: [
              "Use the following runtime information as authoritative:",
              `Operating system: ${operatingSystem.displayName}`,
              `OS identifier: ${operatingSystem.name}`,
              `Command environment: ${operatingSystem.commandEnvironment}`,
              `Shell executable: ${operatingSystem.shell}`,
              `Path separator: ${operatingSystem.pathSeparator}`,
              projectPath
                ? `Working directory: ${projectPath}`
                : "Working directory: application current directory",
              `Requested intent: ${cleanIntent}`,
              "",
              `Generate only a command compatible with ${operatingSystem.commandEnvironment} on ${operatingSystem.displayName}.`,
            ].join("\n"),
          },
        ]);

        console.log(
          "[Terminal Guardrail] Security evaluation:",
          evaluation
        );

        if (!evaluation.is_safe) {
          return `SECURITY_BLOCKED: ${evaluation.reason}`;
        }

        const commandToRun = normalizeCommand(
          evaluation.exact_command
        );

        if (!commandToRun) {
          return "SECURITY_BLOCKED: The command generator approved the request but returned no executable command.";
        }

        const hardBlockReason = getHardBlockReason(
          commandToRun,
          operatingSystem
        );

        if (hardBlockReason) {
          console.warn(
            `[Terminal Guardrail] Command blocked by local protection: ${hardBlockReason}`
          );

          return `SECURITY_BLOCKED: ${hardBlockReason}`;
        }

        console.log(
          `[Terminal Guardrail] Executing ${operatingSystem.commandEnvironment} command: ${JSON.stringify(
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

        const command = Command.create(
          operatingSystem.shell,
          args,
          commandOptions
        );

        const executionResult = await executeWithTimeout(
          command,
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
            `[Terminal Guardrail] Command failed with exit code ${executionResult.code}.`
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
          "[Terminal Guardrail] Command executed successfully."
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
          "[Terminal Guardrail] Evaluation or execution error:",
          error
        );

        return `SYSTEM_ERROR: Failed to evaluate or execute the terminal command on ${operatingSystem.displayName}. ${message}`;
      }
    },
    {
      name: "terminal_intent_executor",
      description: toolDescription,
      schema: z.object({
        intent: z
          .string()
          .min(1)
          .describe(
            [
              "Describe exactly what should be accomplished in the terminal, including relevant paths, filenames, commands, or project details.",
              `The user's operating system is ${operatingSystem.displayName}.`,
              `Commands will be generated for ${operatingSystem.commandEnvironment}.`,
              `Use ${operatingSystem.pathSeparator} as the native path separator when providing platform-specific paths.`,
            ].join(" ")
          ),
      }),
    }
  );
};