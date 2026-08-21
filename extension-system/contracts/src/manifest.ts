export const SUPPORTED_MANIFEST_VERSION = 1 as const;

export const SUPPORTED_EXTENSION_RUNTIMES = [
  "node",
  "python",
] as const;

export type ExtensionRuntime =
  (typeof SUPPORTED_EXTENSION_RUNTIMES)[number];

export interface ExtensionEngines {
  mocu?: string;
  node?: string;
  python?: string;
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
   * Declared extension capabilities.
   *
   * Permissions are descriptive in the first implementation and do not
   * provide an operating-system sandbox.
   */
  permissions?: string[];

  /**
   * Optional extension-specific configuration schema or defaults.
   */
  configuration?: Record<string, unknown>;
}

export interface ManifestValidationSuccess {
  valid: true;
  manifest: ExtensionManifest;
}

export interface ManifestValidationFailure {
  valid: false;
  errors: string[];
}

export type ManifestValidationResult =
  | ManifestValidationSuccess
  | ManifestValidationFailure;

const isRecord = (
  value: unknown,
): value is Record<string, unknown> => {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
};

const isNonEmptyString = (
  value: unknown,
): value is string => {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
};

const isValidExtensionId = (
  value: string,
): boolean => {
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(value);
};

const isValidVersion = (
  value: string,
): boolean => {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
};

const containsUnsafePathPart = (
  value: string,
): boolean => {
  const normalized = value.replaceAll("\\", "/");

  return (
    normalized.startsWith("/") ||
    normalized.includes("../") ||
    normalized === ".." ||
    /^[A-Za-z]:\//.test(normalized)
  );
};

export const validateExtensionManifest = (
  value: unknown,
): ManifestValidationResult => {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ["Manifest must be a JSON object."],
    };
  }

  if (value.manifestVersion !== SUPPORTED_MANIFEST_VERSION) {
    errors.push(
      `manifestVersion must be ${SUPPORTED_MANIFEST_VERSION}.`,
    );
  }

  if (!isNonEmptyString(value.id)) {
    errors.push("id must be a non-empty string.");
  } else if (!isValidExtensionId(value.id)) {
    errors.push(
      "id must use a reverse-domain style identifier such as com.example.extension.",
    );
  }

  if (!isNonEmptyString(value.name)) {
    errors.push("name must be a non-empty string.");
  }

  if (!isNonEmptyString(value.description)) {
    errors.push("description must be a non-empty string.");
  }

  if (!isNonEmptyString(value.version)) {
    errors.push("version must be a non-empty string.");
  } else if (!isValidVersion(value.version)) {
    errors.push(
      "version must be a semantic version such as 1.0.0.",
    );
  }

  if (
    value.runtime !== "node" &&
    value.runtime !== "python"
  ) {
    errors.push(
      'runtime must be either "node" or "python".',
    );
  }

  if (!isNonEmptyString(value.entry)) {
    errors.push("entry must be a non-empty string.");
  } else if (containsUnsafePathPart(value.entry)) {
    errors.push(
      "entry must be a safe relative path inside the extension directory.",
    );
  }

  if (
    value.permissions !== undefined &&
    (
      !Array.isArray(value.permissions) ||
      !value.permissions.every(isNonEmptyString)
    )
  ) {
    errors.push(
      "permissions must be an array of non-empty strings.",
    );
  }

  if (
    value.engines !== undefined &&
    !isRecord(value.engines)
  ) {
    errors.push("engines must be an object.");
  }

  if (
    value.configuration !== undefined &&
    !isRecord(value.configuration)
  ) {
    errors.push("configuration must be an object.");
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    };
  }

  return {
    valid: true,
    manifest: value as unknown as ExtensionManifest,
  };
};