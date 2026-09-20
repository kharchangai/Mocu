import { getSettingsStore } from "../../store";

import type {
  ExtensionConfigField,
  ExtensionManifest,
} from "../types/extension";

/**
 * Per-extension user configuration.
 *
 * An extension can declare inputs it needs from the user (API keys, base
 * URLs, ...) via the `config` array in its manifest. The Extensions page
 * renders one settings form per extension; the filled values are stored in
 * Mocu's settings store (settings.json) under a single
 * `MOCU_EXTENSION_CONFIG` key, keyed by extension id.
 *
 * On every `extension.execute` call the saved values are merged with the
 * declared `default`s and delivered to the extension as the `config` param,
 * so commands always receive fresh values without any extra host call.
 */

const SETTINGS_KEY = "MOCU_EXTENSION_CONFIG";

/** All saved extension config values: { [extensionId]: { [key]: value } }. */
type ExtensionConfigStore = Record<
  string,
  Record<string, string | number | boolean>
>;

export type ExtensionConfigValues = Record<string, string | number | boolean>;

async function readConfigStore(): Promise<ExtensionConfigStore> {
  const store = await getSettingsStore();

  const raw = await store.get<ExtensionConfigStore>(SETTINGS_KEY);

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  return raw;
}

async function writeConfigStore(
  store: ExtensionConfigStore,
): Promise<void> {
  const settingsStore = await getSettingsStore();

  await settingsStore.set(SETTINGS_KEY, store);
}

/** Saved values for one extension (without defaults applied). */
export async function readExtensionConfigValues(
  extensionId: string,
): Promise<ExtensionConfigValues> {
  const store = await readConfigStore();

  const values = store[extensionId];

  return values && typeof values === "object" ? values : {};
}

/**
 * Validate one user-supplied value against its field declaration.
 * Returns an error message, or null when the value is acceptable.
 */
function validateFieldValue(
  field: ExtensionConfigField,
  value: unknown,
): string | null {
  if (field.type === "boolean") {
    if (field.required && typeof value !== "boolean") {
      return `'${field.label}' must be set.`;
    }

    return null;
  }

  const trimmed = String(value ?? "").trim();

  if (field.required && !trimmed) {
    return `'${field.label}' is required.`;
  }

  if (!trimmed) {
    return null;
  }

  if (field.type === "number") {
    if (Number.isNaN(Number(trimmed))) {
      return `'${field.label}' must be a number.`;
    }
  }

  return null;
}

/**
 * Validate and save the user-filled values for one extension.
 * Throws with a readable message when a value fails validation.
 */
export async function saveExtensionConfigValues(
  extensionId: string,
  fields: ExtensionConfigField[],
  values: Record<string, string | number | boolean>,
): Promise<void> {
  const store = await readConfigStore();

  const cleaned: ExtensionConfigValues = {};

  for (const field of fields) {
    const raw = values[field.key];

    const error = validateFieldValue(field, raw);

    if (error) {
      throw new Error(error);
    }

    if (field.type === "boolean") {
      if (typeof raw === "boolean") {
        cleaned[field.key] = raw;
      }

      continue;
    }

    const trimmed = String(raw ?? "").trim();

    if (!trimmed) {
      continue;
    }

    if (field.type === "number") {
      cleaned[field.key] = Number(trimmed);
    } else {
      cleaned[field.key] = trimmed;
    }
  }

  if (Object.keys(cleaned).length === 0) {
    delete store[extensionId];
  } else {
    store[extensionId] = cleaned;
  }

  await writeConfigStore(store);
}

/**
 * Merge saved user values with the manifest defaults.
 *
 * This is what the extension receives as the `config` param on every
 * `extension.execute` call. A field with a default and no saved value
 * resolves to the default; an empty field resolves to an empty string so
 * extensions can detect "not configured" and fail with a clear error.
 */
export async function resolveExtensionConfig(
  manifest: ExtensionManifest,
): Promise<ExtensionConfigValues> {
  const fields = manifest.config ?? [];

  const saved = await readExtensionConfigValues(manifest.id);

  const resolved: ExtensionConfigValues = {};

  for (const field of fields) {
    const value = saved[field.key];

    if (value !== undefined && value !== "") {
      resolved[field.key] = value;
      continue;
    }

    if (field.default !== undefined) {
      resolved[field.key] = field.default;
      continue;
    }

    resolved[field.key] = "";
  }

  return resolved;
}
