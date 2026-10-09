import type { ExtensionApp } from "../types/extension";

/** Validate and normalize a relative UI path; reject paths that can leave the extension root. */
export function parseExtensionApp(value: unknown): ExtensionApp | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.entry !== "string") return undefined;

  const entry = record.entry.trim().replace(/\\/g, "/");
  if (
    !entry ||
    entry.startsWith("/") ||
    /^[a-zA-Z]:/.test(entry) ||
    entry.includes(":") ||
    entry.includes("?") ||
    entry.includes("#") ||
    entry.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return undefined;
  }

  return {
    entry,
    ...(typeof record.title === "string" && record.title.trim()
      ? { title: record.title.trim().slice(0, 80) }
      : {}),
  };
}

export function isSafeExtensionAppEntry(entry: string): boolean {
  return Boolean(parseExtensionApp({ entry }));
}
