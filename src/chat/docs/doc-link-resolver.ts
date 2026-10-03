/**
 * Safe resolution of document references to canonical paths inside the
 * GLOBAL docs folder (BaseDirectory.AppData/docs).
 *
 * The prompt injects references with a `file: "<name>"` field and docs
 * contain descriptive markdown links such as `[deep dive](guides/deep.md)`
 * or `[section](../other.md#anchor)`. The agent follows those leads itself
 * by calling read_knowledge_doc — this module only turns ONE such reference
 * into a safe, docs-relative path for a single read.
 *
 * Rules enforced here (all rejections are explicit, never silent):
 *   - anchors (`#...`) are stripped for lookup; query strings are rejected,
 *   - `http(s)://`, `file://`, `data:` and other URLs are rejected,
 *   - references are resolved against the CURRENT doc's directory inside the
 *     docs root (or against the root itself when there is no current doc),
 *   - root-relative references emitted in the prompt (`/name.md`) and
 *     AppData-relative references (`docs/name.md`) map onto the docs root,
 *   - backslashes are normalized to forward slashes,
 *   - ANY traversal (`..` anywhere), absolute file paths (`C:\...`,
 *     `\\server\share`, `//host/...`) and any result outside the docs root
 *     are rejected.
 *
 * Nothing here reads files, follows links, or calls a model: resolution is
 * pure string work, one reference at a time.
 */

/** Rejection reasons surfaced to the tool layer as user-facing messages. */
export type DocReferenceRejection =
  | "empty"
  | "url"
  | "query-string"
  | "absolute-path"
  | "traversal"
  | "outside-root";

export type ResolveDocReferenceResult =
  | { ok: true; path: string }
  | { ok: false; reason: DocReferenceRejection };

const URL_SCHEME_REGEX = /^[a-z][a-z0-9+.-]*:/i;

/** Strips a trailing markdown/HTML anchor (`#section`) from a reference. */
export function stripAnchor(reference: string): string {
  const hashIndex = reference.indexOf("#");
  return hashIndex === -1 ? reference : reference.slice(0, hashIndex);
}

/**
 * Pure path normalization: forward slashes, resolve `.`/`..` segments.
 * Returns null when the path escapes its root (leading `..` remains) or
 * contains a Windows drive/UNC prefix.
 */
function normalizeSegments(path: string): string | null {
  const unified = path.replace(/\\/g, "/");

  // Drive letters ("C:/...") and UNC/host prefixes ("//server/...").
  if (/^[a-zA-Z]:/.test(unified) || unified.startsWith("//")) {
    return null;
  }

  const out: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (out.length === 0) {
        return null; // escapes the root
      }
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/**
 * Resolves ONE document reference to a safe path relative to the docs root.
 *
 * @param reference  File name, docs-relative link target, or root-relative
 *                   reference (e.g. "my-doc.md", "guides/deep.md",
 *                   "../other.md#anchor", "/my-doc.md", "docs/my-doc.md").
 * @param currentDocPath  Docs-relative path of the doc containing the link
 *                   (e.g. "guides/setup.md"); omitted/empty resolves
 *                   against the docs root.
 */
export function resolveDocReference(
  reference: string,
  currentDocPath?: string,
): ResolveDocReferenceResult {
  const trimmed = (reference ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }

  if (trimmed.includes("?")) {
    return { ok: false, reason: "query-string" };
  }

  const noAnchor = stripAnchor(trimmed);
  if (!noAnchor.trim()) {
    return { ok: false, reason: "empty" };
  }

  const unifiedRef = noAnchor.replace(/\\/g, "/");

  // Absolute file paths FIRST (a Windows drive letter "C:" must not be
  // mistaken for a URL scheme): drive letters, UNC shares, protocol-relative
  // host paths. (A single leading "/" is a docs-ROOT-relative reference that
  // the prompt itself emits, so it is accepted below.)
  if (/^[a-zA-Z]:/.test(unifiedRef) || unifiedRef.startsWith("//")) {
    return { ok: false, reason: "absolute-path" };
  }

  if (URL_SCHEME_REGEX.test(unifiedRef)) {
    return { ok: false, reason: "url" };
  }

  // Docs-root-relative reference as emitted in the prompt: "/my-doc.md".
  if (unifiedRef.startsWith("/")) {
    const rootPath = normalizeSegments(unifiedRef);
    if (rootPath === null || rootPath === "") {
      return { ok: false, reason: "traversal" };
    }
    return { ok: true, path: rootPath };
  }

  // Path of the doc that contains the link (its docs-relative parent).
  const parentRef = (currentDocPath ?? "").trim().replace(/\\/g, "/");
  const parentNormalized = parentRef ? normalizeSegments(parentRef) : "";
  if (parentRef && parentNormalized === null) {
    return { ok: false, reason: "outside-root" };
  }

  let basePath: string;
  if (unifiedRef.startsWith("docs/")) {
    // A leading "docs/" labels the docs root itself (AppData-relative
    // reference); resolve the remainder against the root.
    basePath = unifiedRef.slice("docs/".length);
  } else if (parentNormalized) {
    const parentDir = parentNormalized.includes("/")
      ? parentNormalized.slice(0, parentNormalized.lastIndexOf("/"))
      : "";
    basePath = parentDir ? `${parentDir}/${unifiedRef}` : unifiedRef;
  } else {
    basePath = unifiedRef;
  }

  const normalized = normalizeSegments(basePath);
  if (normalized === null) {
    return { ok: false, reason: "traversal" };
  }
  if (!normalized) {
    return { ok: false, reason: "outside-root" };
  }

  return { ok: true, path: normalized };
}

/** Human-facing message for a rejected reference (safe to show the agent). */
export function describeDocReferenceRejection(
  reason: DocReferenceRejection,
  reference: string,
): string {
  switch (reason) {
    case "empty":
      return "Error: A document reference is required (file name or link target).";
    case "url":
      return `Error: "${reference}" looks like a URL/external address. Only documents inside the global docs folder can be read with this tool.`;
    case "query-string":
      return `Error: "${reference}" contains a query string, which is not part of a document name. Strip everything after "?" and try again.`;
    case "absolute-path":
      return `Error: "${reference}" is an absolute file path. Only documents inside the global docs folder can be read; pass the file name or a docs-relative link target.`;
    case "traversal":
    case "outside-root":
      return `Error: "${reference}" resolves outside the global docs folder. Traversal and out-of-root references are rejected.`;
    default:
      return `Error: "${reference}" could not be resolved to a document inside the global docs folder.`;
  }
}