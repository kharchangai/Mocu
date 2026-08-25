export type ExtensionRuntime = "node" | "python";

export interface ExtensionCommand {
  id: string;
  title: string;
  description?: string;
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
