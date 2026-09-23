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
  /** Allows this command to request buttons/text input in Mocu chat. */
  interactive?: boolean;
  /**
   * Per-command execution timeout in seconds. Omitted -> default (900s).
   * `0` -> no timeout (wait until the extension answers).
   */
  timeoutSeconds?: number;
}

/**
 * One input an extension asks the user to fill in on its card in the
 * Extensions page (API key, base URL, ...). Declared in the manifest's
 * `config` array; the user-filled values are delivered to the extension
 * with every `extension.execute` call.
 */
export interface ExtensionConfigField {
  /** Key the value is delivered under in the extension's `config` object. */
  key: string;
  /** Human-readable label shown in the settings form. */
  label: string;
  /** Optional helper text below the input. */
  description?: string;
  /** Input type. `"password"` masks the value (for API keys). */
  type?: "string" | "number" | "boolean" | "password";
  /** Whether the extension refuses to work without a value. */
  required?: boolean;
  /** Value used when the user has not filled anything in. */
  default?: string | number | boolean;
  /** Placeholder text inside the empty input. */
  placeholder?: string;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  runtime: ExtensionRuntime;
  entry: string;
  commands?: ExtensionCommand[];
  /**
   * Inputs the extension needs from the user. Rendered as a settings form
   * on the extension's card; values are merged with `default`s and sent to
   * the extension as the `config` param of `extension.execute`.
   */
  config?: ExtensionConfigField[];
}

export interface InstalledExtension {
  path: string;
  manifestPath: string;
  manifest: ExtensionManifest;
}
