"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.terminalExecutionTool = void 0;
var tools_1 = require("@langchain/core/tools");
var zod_1 = require("zod");
var plugin_shell_1 = require("@tauri-apps/plugin-shell");
var SecurityCheckSchema = zod_1.z.object({
    is_safe: zod_1.z
        .boolean()
        .describe("True for normal terminal and development operations. False only for destructive system-level actions, deletion of critical files, credential theft, or clearly malicious commands."),
    reason: zod_1.z
        .string()
        .describe("A short explanation describing why the command is allowed or blocked."),
    exact_command: zod_1.z
        .string()
        .describe("The exact single-line command compatible with the detected operating system and shell. It must be empty when is_safe is false."),
});
var DEFAULT_MAX_OUTPUT_LENGTH = 100000;
var DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
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
function detectOperatingSystem() {
    var _a, _b, _c, _d, _e, _f, _g;
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
    var navigatorWithUserAgentData = navigator;
    var userAgent = (_b = (_a = navigator.userAgent) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== null && _b !== void 0 ? _b : "";
    var navigatorPlatform = (_d = (_c = navigator.platform) === null || _c === void 0 ? void 0 : _c.toLowerCase()) !== null && _d !== void 0 ? _d : "";
    var userAgentDataPlatform = (_g = (_f = (_e = navigatorWithUserAgentData.userAgentData) === null || _e === void 0 ? void 0 : _e.platform) === null || _f === void 0 ? void 0 : _f.toLowerCase()) !== null && _g !== void 0 ? _g : "";
    var combinedPlatformInformation = [
        userAgent,
        navigatorPlatform,
        userAgentDataPlatform,
    ].join(" ");
    var isWindows = combinedPlatformInformation.includes("windows") ||
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
    var isMacOS = combinedPlatformInformation.includes("macintosh") ||
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
    var isLinux = combinedPlatformInformation.includes("linux") ||
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
function normalizeCommand(command) {
    return command.replace(/\0/g, "").trim();
}
function truncateOutput(value, maximumLength) {
    if (value.length <= maximumLength) {
        return value;
    }
    var removedCharacters = value.length - maximumLength;
    return "".concat(value.slice(0, maximumLength), "\n\n[OUTPUT_TRUNCATED: ").concat(removedCharacters, " characters were omitted.]");
}
function formatUnknownError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "string") {
        return error;
    }
    try {
        return JSON.stringify(error);
    }
    catch (_a) {
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
function getHardBlockReason(command, operatingSystem) {
    var normalized = command
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
        var blockedWindowsPatterns = [
            {
                pattern: /\b(format|format-volume|clear-disk|initialize-disk)\b/i,
                reason: "Formatting, clearing, or reinitializing a physical disk is blocked.",
            },
            {
                pattern: /\b(remove-partition|delete\s+partition)\b/i,
                reason: "Deleting disk partitions is blocked.",
            },
            {
                pattern: /\b(remove-item|del|erase|rd|rmdir)\b[^;&|]*(?:[a-z]:\\windows|[a-z]:\\programdata|[a-z]:\\program files|[a-z]:\\program files \(x86\))/i,
                reason: "Deleting protected Windows system or application directories is blocked.",
            },
            {
                pattern: /\b(remove-item|del|erase|rd|rmdir)\b[^;&|]*(?:[a-z]:\\users\\[^\\]+\\appdata)(?:\\|\s|["']|$)/i,
                reason: "Deleting a user's complete application-data directory is blocked.",
            },
            {
                pattern: /\b(remove-item|del|erase|rd|rmdir)\b[^;&|]*["']?[a-z]:\\["']?\s*[^;&|]*(?:\/s|\/q|-recurse|-force)/i,
                reason: "Recursive deletion of an entire drive root is blocked.",
            },
            {
                pattern: /\b(reg\s+(?:add|delete)|remove-itemproperty|set-itemproperty)\b[^;&|]*(?:hklm|hkey_local_machine|hkey_classes_root)/i,
                reason: "Modification of protected machine-wide registry areas is blocked.",
            },
            {
                pattern: /\b(shutdown|restart-computer|stop-computer)\b/i,
                reason: "Shutting down or restarting the operating system is blocked.",
            },
            {
                pattern: /\b(stop-process|taskkill)\b[^;&|]*(?:lsass|csrss|wininit|services|smss|winlogon|system)\b/i,
                reason: "Terminating a critical Windows process is blocked.",
            },
            {
                pattern: /\b(vssadmin\s+delete\s+shadows|wbadmin\s+delete|bcdedit\s+\/delete)\b/i,
                reason: "Deleting recovery data or boot configuration is blocked.",
            },
            {
                pattern: /\b(netsh\s+advfirewall\s+set\s+allprofiles\s+state\s+off|set-mppreference\s+-disablerealtimemonitoring\s+\$true)\b/i,
                reason: "Disabling operating-system security controls is blocked.",
            },
            {
                pattern: /\b(mimikatz|sekurlsa|procdump)\b[^;&|]*(?:lsass|logonpasswords)/i,
                reason: "Credential extraction from operating-system processes is blocked.",
            },
        ];
        for (var _i = 0, blockedWindowsPatterns_1 = blockedWindowsPatterns; _i < blockedWindowsPatterns_1.length; _i++) {
            var rule = blockedWindowsPatterns_1[_i];
            if (rule.pattern.test(normalized)) {
                return rule.reason;
            }
        }
        return null;
    }
    var blockedPosixPatterns = [
        {
            pattern: /\brm\b[^;&|]*(?:-[a-z]*r[a-z]*f|-{1,2}recursive[^;&|]*-{1,2}force|-{1,2}force[^;&|]*-{1,2}recursive)[^;&|]*(?:\/|\/\*)\s*(?:[;&|]|$)/i,
            reason: "Recursive forced deletion of the filesystem root is blocked.",
        },
        {
            pattern: /\brm\b[^;&|]*(?:-[a-z]*r[a-z]*f|-{1,2}recursive)[^;&|]*(?:\/etc|\/usr|\/bin|\/sbin|\/boot|\/system|\/library|\/private|\/var\/db)(?:\/|\s|[;&|]|$)/i,
            reason: "Recursive deletion of critical operating-system directories is blocked.",
        },
        {
            pattern: /\b(?:find|xargs)\b[^;&|]*(?:\/etc|\/usr|\/bin|\/sbin|\/boot|\/system|\/library|\/private|\/var\/db)[^;&|]*(?:-delete|\brm\b)/i,
            reason: "Bulk deletion inside a critical operating-system directory is blocked.",
        },
        {
            pattern: /\b(?:mkfs(?:\.[a-z0-9]+)?|fdisk|parted|diskutil\s+(?:erase|partition)|dd)\b[^;&|]*(?:\/dev\/|physicaldrive)/i,
            reason: "Formatting, partitioning, or overwriting a physical disk is blocked.",
        },
        {
            pattern: /\bdd\b[^;&|]*\bof\s*=\s*\/dev\/(?:sd[a-z]|nvme\d+n\d+|disk\d+|rdisk\d+)/i,
            reason: "Raw writes to a physical disk are blocked.",
        },
        {
            pattern: />{1,2}\s*\/(?:etc\/(?:passwd|shadow|sudoers)|boot\/|system\/|library\/|private\/etc\/)/i,
            reason: "Overwriting a critical operating-system file is blocked.",
        },
        {
            pattern: /\b(?:chmod|chown|chgrp)\b[^;&|]*(?:\/etc\/(?:passwd|shadow|sudoers)|\/system\/|\/boot\/)/i,
            reason: "Changing permissions or ownership of critical system files is blocked.",
        },
        {
            pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/i,
            reason: "Shutting down or restarting the operating system is blocked.",
        },
        {
            pattern: /\bkill(?:all)?\b[^;&|]*(?:launchd|systemd|init|kernel_task)\b/i,
            reason: "Terminating a critical operating-system process is blocked.",
        },
        {
            pattern: /\b(?:csrutil\s+disable|spctl\s+--master-disable|systemctl\s+disable\s+(?:firewalld|ufw)|ufw\s+disable)\b/i,
            reason: "Disabling operating-system security controls is blocked.",
        },
        {
            pattern: /\b(?:cat|grep|awk|sed|cp|curl|wget)\b[^;&|]*(?:\/etc\/shadow|\/etc\/sudoers|\.ssh\/id_(?:rsa|ed25519)|keychain)[^;&|]*(?:https?:\/\/|nc\b|netcat\b|curl\b|wget\b)/i,
            reason: "Reading and transmitting credentials or protected secrets is blocked.",
        },
    ];
    for (var _a = 0, blockedPosixPatterns_1 = blockedPosixPatterns; _a < blockedPosixPatterns_1.length; _a++) {
        var rule = blockedPosixPatterns_1[_a];
        if (rule.pattern.test(normalized)) {
            return rule.reason;
        }
    }
    return null;
}
function executeWithTimeout(command, timeoutMs) {
    return __awaiter(this, void 0, void 0, function () {
        var timeoutId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, , 2, 3]);
                    return [4 /*yield*/, Promise.race([
                            command.execute(),
                            new Promise(function (_, reject) {
                                timeoutId = setTimeout(function () {
                                    reject(new Error("Command execution exceeded the ".concat(timeoutMs, "ms time limit.")));
                                }, timeoutMs);
                            }),
                        ])];
                case 1: return [2 /*return*/, _a.sent()];
                case 2:
                    if (timeoutId !== undefined) {
                        clearTimeout(timeoutId);
                    }
                    return [7 /*endfinally*/];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function createOperatingSystemPrompt(operatingSystem) {
    if (operatingSystem.isWindows) {
        return "\nOPERATING SYSTEM:\n- The user's operating system is Microsoft Windows.\n- Generate PowerShell syntax only.\n- Commands are executed with Windows PowerShell.\n- Use Windows path syntax such as C:\\Users\\Name\\Project.\n- Use PowerShell cmdlets when appropriate.\n- Do not generate Bash, sh, zsh, macOS, or Linux commands.\n- Do not use commands such as rm, touch, grep, sed, awk, chmod, or export unless they are known aliases that are appropriate in PowerShell.\n- Prefer commands such as Get-ChildItem, Get-Content, Set-Content, New-Item, Copy-Item, Move-Item, Remove-Item, Select-String, and $env:NAME.\n- Quote Windows paths safely with PowerShell-compatible quoting.\n";
    }
    if (operatingSystem.isMacOS) {
        return "\nOPERATING SYSTEM:\n- The user's operating system is Apple macOS.\n- Generate POSIX shell syntax compatible with /bin/sh.\n- Use macOS-compatible commands and options.\n- Use POSIX paths such as /Users/name/project.\n- Do not generate PowerShell, cmd.exe, Windows paths, Windows environment-variable syntax, or Linux-only commands.\n- Do not assume GNU-specific command options are available because macOS commonly uses BSD utilities.\n- Use macOS commands such as open and pbcopy only when the task specifically requires them.\n- Quote paths safely with POSIX shell-compatible quoting.\n";
    }
    if (operatingSystem.isLinux) {
        return "\nOPERATING SYSTEM:\n- The user's operating system is Linux.\n- Generate POSIX shell syntax compatible with /bin/sh.\n- Use Linux-compatible commands and options.\n- Use POSIX paths such as /home/name/project.\n- Do not generate PowerShell, cmd.exe, Windows paths, Windows environment-variable syntax, or macOS-only commands.\n- Do not use macOS-only commands such as open, pbcopy, pbpaste, or diskutil.\n- Quote paths safely with POSIX shell-compatible quoting.\n";
    }
    return "\nOPERATING SYSTEM:\n- Exact operating-system detection was unavailable.\n- Treat the environment as Unix-like.\n- Generate conservative POSIX shell syntax compatible with /bin/sh.\n- Do not use PowerShell, cmd.exe, Windows paths, or platform-specific commands unless explicitly requested.\n- Prefer portable POSIX commands.\n- Quote paths safely with POSIX shell-compatible quoting.\n";
}
var terminalExecutionTool = function (llm, options) {
    if (options === void 0) { options = {}; }
    var projectPath = options.projectPath, _a = options.maxOutputLength, maxOutputLength = _a === void 0 ? DEFAULT_MAX_OUTPUT_LENGTH : _a, _b = options.timeoutMs, timeoutMs = _b === void 0 ? DEFAULT_TIMEOUT_MS : _b;
    /*
     * Detect the OS before defining the tool.
     *
     * This makes the OS available not only while executing the tool, but also
     * in the tool description and input schema that the main agent sees during
     * tool selection.
     */
    var operatingSystem = detectOperatingSystem();
    var executionContext = projectPath
        ? "Commands start in the selected project directory: ".concat(projectPath)
        : "Commands start in the application's current working directory.";
    var toolDescription = [
        "Execute terminal operations on ".concat(operatingSystem.displayName, "."),
        "The command environment is ".concat(operatingSystem.commandEnvironment, "."),
        executionContext,
        "This tool allows normal file operations, project-local deletion, Git, package managers, scripts, builds, tests, network requests, and developer tools.",
        "It blocks only destructive system-file deletion, disk destruction, critical operating-system modification, credential theft, and clearly malicious actions.",
        "All generated commands must be compatible with ".concat(operatingSystem.shellDescription, " on ").concat(operatingSystem.displayName, "."),
        "Provide the intended result rather than a raw shell command.",
    ].join(" ");
    return (0, tools_1.tool)(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var cleanIntent, operatingSystemPrompt, securitySystemPrompt, structuredSecurityLlm, evaluation, commandToRun, hardBlockReason, args, commandOptions, command, executionResult, stdout, stderr, error_1, message;
        var _c, _d, _e;
        var intent = _b.intent;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    cleanIntent = intent.trim();
                    if (!cleanIntent) {
                        return [2 /*return*/, "INVALID_INTENT: Terminal intent cannot be empty."];
                    }
                    console.log("[Terminal Guardrail] Received intent: ".concat(JSON.stringify(cleanIntent)));
                    console.log("[Terminal Guardrail] Operating system: ".concat(operatingSystem.displayName));
                    console.log("[Terminal Guardrail] OS identifier: ".concat(operatingSystem.name));
                    console.log("[Terminal Guardrail] Command environment: ".concat(operatingSystem.commandEnvironment));
                    console.log("[Terminal Guardrail] Executable shell: ".concat(operatingSystem.shell));
                    operatingSystemPrompt = createOperatingSystemPrompt(operatingSystem);
                    securitySystemPrompt = "\nYou are Mocu's terminal security evaluator and command generator.\n\nThe operating system has already been detected by the application. You must follow the detected operating-system information below and must not guess or replace it.\n\n".concat(operatingSystemPrompt, "\n\nRUNTIME ENVIRONMENT:\n- Detected OS identifier: ").concat(operatingSystem.name, "\n- Detected OS display name: ").concat(operatingSystem.displayName, "\n- Command environment: ").concat(operatingSystem.commandEnvironment, "\n- Shell executable: ").concat(operatingSystem.shell, "\n- Path separator: ").concat(operatingSystem.pathSeparator, "\n- Working directory: ").concat(projectPath
                        ? JSON.stringify(projectPath)
                        : "application current working directory", "\n\nConvert the agent's intent into one practical, single-line command that is compatible with the detected operating system and shell.\n\nDEFAULT POLICY:\n- Default to ALLOW.\n- Normal developer and user-level terminal work must be approved.\n- Do not reject a command merely because it creates, reads, edits, moves, copies, installs, compiles, or deletes ordinary project files.\n- Do not be overly cautious about standard development operations.\n- Set is_safe=true unless the requested action clearly matches one of the blocked categories below.\n\nALLOW:\n- Reading, creating, editing, copying, moving, renaming, and organizing normal files.\n- Deleting ordinary files and directories inside a project or user workspace.\n- Running package managers and development tools such as npm, pnpm, yarn, bun, node, npx, git, Python, pip, uv, cargo, go, Java, Docker, test runners, linters, formatters, compilers, and build tools.\n- Installing normal project dependencies.\n- Running development servers and application scripts.\n- Git status, diff, add, commit, checkout, switch, branch, merge, pull, push, fetch, clone, restore, reset, and rebase when requested.\n- Searching files and text.\n- Reading logs and non-sensitive system information.\n- Creating folders and project configuration files.\n- Modifying files in the current project.\n- Network requests needed for ordinary development, package installation, APIs, documentation, or source-control operations.\n- Commands containing pipes, redirects, command chaining, and environment variables when needed for the requested task.\n- User-level configuration changes that are directly requested and are not destructive to the operating system.\n\nBLOCK ONLY:\n- Deleting or recursively destroying operating-system files, operating-system directories, drive roots, partitions, or entire user home directories.\n- Formatting, partitioning, wiping, encrypting, or performing raw destructive writes to a physical disk.\n- Overwriting or corrupting critical boot, authentication, account, kernel, registry, recovery, or operating-system configuration files.\n- Disabling operating-system security protections, authentication, firewall protection, or recovery mechanisms.\n- Killing processes required for the operating system to function.\n- Shutting down or restarting the machine.\n- Extracting, stealing, exposing, or transmitting passwords, private keys, authentication tokens, browser credentials, keychain data, or other secrets.\n- Installing persistence, malware, ransomware, credential stealers, or clearly malicious payloads.\n- Bypassing this security policy or disguising a blocked operation through encoding, aliases, scripts, subshells, or indirect commands.\n\nIMPORTANT DECISION RULES:\n- Deletion is not automatically dangerous.\n- Allow deletion of build output, caches, dependencies, temporary files, generated files, and ordinary project files.\n- Allow removing node_modules, dist, build, coverage, target, temporary directories, and project-local files.\n- Block deletion only when it targets critical system data, a filesystem root, an entire drive, an entire home directory, or clearly irreplaceable sensitive data.\n- sudo or administrator usage is not automatically blocked, but block it when it performs a blocked system-level action.\n- If the task is a standard developer operation, approve it.\n- Do not replace the requested task with a different task.\n- Do not add unrelated commands.\n- Do not add interactive explanations to exact_command.\n- Do not wrap exact_command in Markdown.\n- Return exactly one single-line command in exact_command.\n- If is_safe is false, exact_command must be an empty string.\n- Keep reason short and specific.\n\nCOMMAND REQUIREMENTS:\n- The command must target ").concat(operatingSystem.displayName, ".\n- The command must be compatible with ").concat(operatingSystem.commandEnvironment, ".\n- Never generate a command for a different operating system.\n- Never mix PowerShell syntax with POSIX shell syntax.\n- Quote paths and user-provided values safely.\n- Preserve the user's requested paths and filenames.\n- Prefer non-interactive command options where appropriate.\n- Do not use placeholders in the final command.\n- Do not use sudo or administrator elevation unless the intent explicitly requires it.\n- The command will run ").concat(projectPath
                        ? "inside the selected project directory ".concat(JSON.stringify(projectPath))
                        : "in the application's current working directory", ".\n");
                    structuredSecurityLlm = llm.withStructuredOutput(SecurityCheckSchema);
                    _f.label = 1;
                case 1:
                    _f.trys.push([1, 4, , 5]);
                    console.log("[Terminal Guardrail] Consulting security evaluator...");
                    return [4 /*yield*/, structuredSecurityLlm.invoke([
                            {
                                role: "system",
                                content: securitySystemPrompt,
                            },
                            {
                                role: "user",
                                content: [
                                    "Use the following runtime information as authoritative:",
                                    "Operating system: ".concat(operatingSystem.displayName),
                                    "OS identifier: ".concat(operatingSystem.name),
                                    "Command environment: ".concat(operatingSystem.commandEnvironment),
                                    "Shell executable: ".concat(operatingSystem.shell),
                                    "Path separator: ".concat(operatingSystem.pathSeparator),
                                    projectPath
                                        ? "Working directory: ".concat(projectPath)
                                        : "Working directory: application current directory",
                                    "Requested intent: ".concat(cleanIntent),
                                    "",
                                    "Generate only a command compatible with ".concat(operatingSystem.commandEnvironment, " on ").concat(operatingSystem.displayName, "."),
                                ].join("\n"),
                            },
                        ])];
                case 2:
                    evaluation = _f.sent();
                    console.log("[Terminal Guardrail] Security evaluation:", evaluation);
                    if (!evaluation.is_safe) {
                        return [2 /*return*/, "SECURITY_BLOCKED: ".concat(evaluation.reason)];
                    }
                    commandToRun = normalizeCommand(evaluation.exact_command);
                    if (!commandToRun) {
                        return [2 /*return*/, "SECURITY_BLOCKED: The command generator approved the request but returned no executable command."];
                    }
                    hardBlockReason = getHardBlockReason(commandToRun, operatingSystem);
                    if (hardBlockReason) {
                        console.warn("[Terminal Guardrail] Command blocked by local protection: ".concat(hardBlockReason));
                        return [2 /*return*/, "SECURITY_BLOCKED: ".concat(hardBlockReason)];
                    }
                    console.log("[Terminal Guardrail] Executing ".concat(operatingSystem.commandEnvironment, " command: ").concat(JSON.stringify(commandToRun)));
                    args = operatingSystem.isWindows
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
                    commandOptions = projectPath
                        ? {
                            cwd: projectPath,
                        }
                        : undefined;
                    command = plugin_shell_1.Command.create(operatingSystem.shell, args, commandOptions);
                    return [4 /*yield*/, executeWithTimeout(command, timeoutMs)];
                case 3:
                    executionResult = _f.sent();
                    stdout = truncateOutput((_c = executionResult.stdout) !== null && _c !== void 0 ? _c : "", maxOutputLength);
                    stderr = truncateOutput((_d = executionResult.stderr) !== null && _d !== void 0 ? _d : "", maxOutputLength);
                    if (executionResult.code !== 0) {
                        console.error("[Terminal Guardrail] Command failed with exit code ".concat(executionResult.code, "."));
                        return [2 /*return*/, [
                                "EXECUTION_FAILED",
                                "Operating system: ".concat(operatingSystem.displayName),
                                "Shell: ".concat(operatingSystem.shellDescription),
                                "Exit code: ".concat((_e = executionResult.code) !== null && _e !== void 0 ? _e : "unknown"),
                                stdout ? "Standard output:\n".concat(stdout) : "",
                                stderr ? "Error output:\n".concat(stderr) : "",
                            ]
                                .filter(Boolean)
                                .join("\n\n")];
                    }
                    console.log("[Terminal Guardrail] Command executed successfully.");
                    if (stdout && stderr) {
                        return [2 /*return*/, [
                                "Command executed successfully.",
                                "Operating system: ".concat(operatingSystem.displayName),
                                "Output:\n".concat(stdout),
                                "Warnings:\n".concat(stderr),
                            ].join("\n\n")];
                    }
                    if (stdout) {
                        return [2 /*return*/, stdout];
                    }
                    if (stderr) {
                        return [2 /*return*/, "Command executed successfully with warnings:\n".concat(stderr)];
                    }
                    return [2 /*return*/, "Command executed successfully with no output."];
                case 4:
                    error_1 = _f.sent();
                    message = formatUnknownError(error_1);
                    console.error("[Terminal Guardrail] Evaluation or execution error:", error_1);
                    return [2 /*return*/, "SYSTEM_ERROR: Failed to evaluate or execute the terminal command on ".concat(operatingSystem.displayName, ". ").concat(message)];
                case 5: return [2 /*return*/];
            }
        });
    }); }, {
        name: "terminal_intent_executor",
        description: toolDescription,
        schema: zod_1.z.object({
            intent: zod_1.z
                .string()
                .min(1)
                .describe([
                "Describe exactly what should be accomplished in the terminal, including relevant paths, filenames, commands, or project details.",
                "The user's operating system is ".concat(operatingSystem.displayName, "."),
                "Commands will be generated for ".concat(operatingSystem.commandEnvironment, "."),
                "Use ".concat(operatingSystem.pathSeparator, " as the native path separator when providing platform-specific paths."),
            ].join(" ")),
        }),
    });
};
exports.terminalExecutionTool = terminalExecutionTool;
