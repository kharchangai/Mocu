export type ExtensionRuntime = "node" | "python";

export interface ExtensionCommand {
  id: string;
  title: string;
  description?: string;
  /**
   * When true, the command streams live progress to the chat via
   * `mocu.extension.activity` notifications while it runs. The chat
   * renders those updates inside the command's tool card.
   */
  streaming?: boolean;
  /**
   * Per-command execution timeout in seconds. Omitted -> default (900s).
   * `0` -> no timeout (wait until the extension answers).
   */
  timeoutSeconds?: number;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  runtime: ExtensionRuntime;
  entry: string;
  commands?: ExtensionCommand[];
}

export interface InstalledExtension {
  path: string;
  manifestPath: string;
  manifest: ExtensionManifest;
}
