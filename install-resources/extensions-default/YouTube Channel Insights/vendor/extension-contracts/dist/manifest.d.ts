export declare const SUPPORTED_MANIFEST_VERSION: 1;
export declare const SUPPORTED_EXTENSION_RUNTIMES: readonly ["node", "python"];
export type ExtensionRuntime = (typeof SUPPORTED_EXTENSION_RUNTIMES)[number];
export interface ExtensionEngines {
    mocu?: string;
    node?: string;
    python?: string;
}
export interface ExtensionCommand {
    id: string;
    title: string;
    description?: string;
    streaming?: boolean;
    timeoutSeconds?: number;
    /** Allows this command to request a user-facing chat interaction. */
    interactive?: boolean;
}
export interface ExtensionManifest {
    manifestVersion: typeof SUPPORTED_MANIFEST_VERSION;
    /**
     * Permanent and globally unique extension identifier.
     *
     * Example:
     * com.example.hello-node
     */
    id: string;
    /**
     * Human-readable extension name.
     */
    name: string;
    /**
     * Human-readable extension description.
     */
    description: string;
    /**
     * Semantic extension version.
     *
     * Example:
     * 1.0.0
     */
    version: string;
    /**
     * Runtime used to start the extension.
     */
    runtime: ExtensionRuntime;
    /**
     * Entry file relative to the extension directory.
     *
     * Examples:
     * dist/main.js
     * main.py
     */
    entry: string;
    /**
     * Optional runtime compatibility information.
     */
    engines?: ExtensionEngines;
    /**
     * Declared extension capabilities. Host calls to user agent APIs require
     * `"agents.invoke"`; this declaration is enforced by the host bridge.
     */
    permissions?: string[];
    /**
     * Optional extension-specific configuration schema or defaults.
     */
    configuration?: Record<string, unknown>;
    /** Commands exposed to the agent and their optional capabilities. */
    commands?: ExtensionCommand[];
}
export interface ManifestValidationSuccess {
    valid: true;
    manifest: ExtensionManifest;
}
export interface ManifestValidationFailure {
    valid: false;
    errors: string[];
}
export type ManifestValidationResult = ManifestValidationSuccess | ManifestValidationFailure;
export declare const validateExtensionManifest: (value: unknown) => ManifestValidationResult;
//# sourceMappingURL=manifest.d.ts.map