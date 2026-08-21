import {
  mkdir,
  readDir,
  readTextFile,
  remove,
} from "@tauri-apps/plugin-fs";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * The supported operations of the folder tool.
 */
const folderActionSchema = z.enum([
  "create_folder",
  "delete",
  "list",
  "search",
  "read_file",
]);

export type FolderAction = z.infer<typeof folderActionSchema>;

/**
 * Input accepted by the folder_operations tool.
 *
 * rootLocation:
 * The project or workspace directory selected by the user.
 *
 * path:
 * A path relative to rootLocation.
 *
 * Examples:
 * - "."
 * - "src"
 * - "src/components"
 * - "src/index.ts"
 */
const folderOperationsInputSchema = z
  .object({
    action: folderActionSchema.describe(
      [
        "Operation to perform.",
        "create_folder creates a directory.",
        "delete removes a file or directory.",
        "list returns directory contents.",
        "search searches file and directory names.",
        "read_file reads a UTF-8 text file.",
      ].join(" "),
    ),

    rootLocation: z
      .string()
      .trim()
      .min(1)
      .describe(
        "The absolute root directory selected by the user. All operations are restricted to this location.",
      ),

    path: z
      .string()
      .trim()
      .default(".")
      .describe(
        "A path relative to rootLocation. Use '.' for the root directory.",
      ),

    query: z
      .string()
      .trim()
      .optional()
      .describe(
        "Search text required only when action is search.",
      ),

    recursive: z
      .boolean()
      .default(false)
      .describe(
        "Whether list, search, create_folder, or delete should operate recursively when applicable.",
      ),

    maxResults: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe(
        "Maximum number of results returned by list or search.",
      ),
  })
  .superRefine((input, context) => {
    if (
      input.action === "search" &&
      (!input.query || input.query.trim().length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["query"],
        message: "query is required when action is search.",
      });
    }
  });

export type FolderOperationsInput = z.infer<
  typeof folderOperationsInputSchema
>;

type DirectoryItem = {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink" | "unknown";
};

type FolderToolResult =
  | {
      success: true;
      action: FolderAction;
      rootLocation: string;
      targetPath: string;
      message: string;
      items?: DirectoryItem[];
      content?: string;
      truncated?: boolean;
    }
  | {
      success: false;
      action: FolderAction;
      rootLocation: string;
      targetPath: string;
      error: string;
    };

/**
 * Replaces Windows separators with forward slashes so paths can be
 * validated consistently.
 */
function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * Removes unnecessary trailing separators while preserving filesystem
 * roots such as "/" and "C:/".
 */
function removeTrailingSeparators(value: string): string {
  const normalized = normalizeSeparators(value);

  if (normalized === "/") {
    return normalized;
  }

  if (/^[A-Za-z]:\/$/.test(normalized)) {
    return normalized;
  }

  return normalized.replace(/\/+$/, "");
}

/**
 * Normalizes the root path without allowing an empty value.
 */
function normalizeRootLocation(rootLocation: string): string {
  const normalized = removeTrailingSeparators(
    rootLocation.trim(),
  );

  if (!normalized) {
    throw new Error("rootLocation cannot be empty.");
  }

  return normalized;
}

/**
 * Validates a relative path and prevents directory traversal.
 *
 * The internal agent must only pass paths relative to rootLocation.
 * Absolute paths and ".." traversal segments are rejected.
 */
function normalizeRelativePath(relativePath: string): string {
  const normalized = normalizeSeparators(
    relativePath.trim() || ".",
  );

  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.startsWith("//")
  ) {
    throw new Error(
      "path must be relative to rootLocation, not absolute.",
    );
  }

  const safeSegments: string[] = [];

  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      throw new Error(
        "Parent directory traversal using '..' is not allowed.",
      );
    }

    if (segment.includes("\0")) {
      throw new Error("The path contains an invalid null character.");
    }

    safeSegments.push(segment);
  }

  return safeSegments.length > 0
    ? safeSegments.join("/")
    : ".";
}

/**
 * Joins rootLocation with a validated relative path.
 */
function createTargetPath(
  rootLocation: string,
  relativePath: string,
): {
  normalizedRoot: string;
  normalizedRelativePath: string;
  targetPath: string;
} {
  const normalizedRoot =
    normalizeRootLocation(rootLocation);

  const normalizedRelativePath =
    normalizeRelativePath(relativePath);

  if (normalizedRelativePath === ".") {
    return {
      normalizedRoot,
      normalizedRelativePath,
      targetPath: normalizedRoot,
    };
  }

  return {
    normalizedRoot,
    normalizedRelativePath,
    targetPath: `${normalizedRoot}/${normalizedRelativePath}`,
  };
}

/**
 * Joins an already validated path with a child name returned by
 * Tauri's readDir function.
 */
function joinChildPath(
  parentPath: string,
  childName: string,
): string {
  return `${removeTrailingSeparators(parentPath)}/${childName}`;
}

/**
 * Returns an item type from a Tauri directory entry.
 */
function getEntryType(entry: {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}): DirectoryItem["type"] {
  if (entry.isDirectory) {
    return "directory";
  }

  if (entry.isFile) {
    return "file";
  }

  if (entry.isSymlink) {
    return "symlink";
  }

  return "unknown";
}

/**
 * Converts a full path back to a path relative to rootLocation.
 */
function toRelativeDisplayPath(
  rootLocation: string,
  fullPath: string,
): string {
  const root = removeTrailingSeparators(rootLocation);
  const full = normalizeSeparators(fullPath);

  if (full === root) {
    return ".";
  }

  const rootPrefix = `${root}/`;

  if (full.startsWith(rootPrefix)) {
    return full.slice(rootPrefix.length);
  }

  return full;
}

/**
 * Reads a directory and returns its contents.
 *
 * Symlink directories are not traversed. This prevents recursive
 * traversal from unexpectedly leaving the selected root directory.
 */
async function listDirectoryContents(options: {
  rootLocation: string;
  targetPath: string;
  recursive: boolean;
  maxResults: number;
}): Promise<{
  items: DirectoryItem[];
  truncated: boolean;
}> {
  const {
    rootLocation,
    targetPath,
    recursive,
    maxResults,
  } = options;

  const items: DirectoryItem[] = [];
  let truncated = false;

  async function walk(currentPath: string): Promise<void> {
    if (items.length >= maxResults) {
      truncated = true;
      return;
    }

    const entries = await readDir(currentPath);

    entries.sort((first, second) =>
      first.name.localeCompare(second.name),
    );

    for (const entry of entries) {
      if (items.length >= maxResults) {
        truncated = true;
        return;
      }

      const fullPath = joinChildPath(
        currentPath,
        entry.name,
      );

      items.push({
        name: entry.name,
        path: toRelativeDisplayPath(
          rootLocation,
          fullPath,
        ),
        type: getEntryType(entry),
      });

      if (
        recursive &&
        entry.isDirectory &&
        !entry.isSymlink
      ) {
        await walk(fullPath);
      }
    }
  }

  await walk(targetPath);

  return {
    items,
    truncated,
  };
}

/**
 * Recursively searches file and directory names.
 *
 * Search is case-insensitive and symlink directories are not followed.
 */
async function searchDirectory(options: {
  rootLocation: string;
  targetPath: string;
  query: string;
  recursive: boolean;
  maxResults: number;
}): Promise<{
  items: DirectoryItem[];
  truncated: boolean;
}> {
  const {
    rootLocation,
    targetPath,
    query,
    recursive,
    maxResults,
  } = options;

  const normalizedQuery = query.trim().toLowerCase();
  const matches: DirectoryItem[] = [];
  let truncated = false;

  async function walk(currentPath: string): Promise<void> {
    if (matches.length >= maxResults) {
      truncated = true;
      return;
    }

    const entries = await readDir(currentPath);

    entries.sort((first, second) =>
      first.name.localeCompare(second.name),
    );

    for (const entry of entries) {
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }

      const fullPath = joinChildPath(
        currentPath,
        entry.name,
      );

      const relativePath = toRelativeDisplayPath(
        rootLocation,
        fullPath,
      );

      if (
        entry.name.toLowerCase().includes(normalizedQuery) ||
        relativePath.toLowerCase().includes(normalizedQuery)
      ) {
        matches.push({
          name: entry.name,
          path: relativePath,
          type: getEntryType(entry),
        });
      }

      if (
        recursive &&
        entry.isDirectory &&
        !entry.isSymlink
      ) {
        await walk(fullPath);
      }
    }
  }

  await walk(targetPath);

  return {
    items: matches,
    truncated,
  };
}

/**
 * Converts a result object into a stable string that can be returned
 * from a LangChain tool.
 */
function serializeResult(result: FolderToolResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Executes one filesystem operation.
 */
async function executeFolderOperation(
  input: FolderOperationsInput,
): Promise<string> {
  const {
    action,
    rootLocation,
    path,
    recursive,
    maxResults,
  } = input;

  let normalizedRoot = rootLocation.trim();
  let targetPath = path.trim() || ".";

  try {
    const resolved = createTargetPath(
      rootLocation,
      path,
    );

    normalizedRoot = resolved.normalizedRoot;
    targetPath = resolved.targetPath;

    switch (action) {
      case "create_folder": {
        if (
          resolved.normalizedRelativePath === "."
        ) {
          throw new Error(
            "Refusing to create the root location itself. Provide a relative folder path.",
          );
        }

        await mkdir(targetPath, {
          recursive,
        });

        return serializeResult({
          success: true,
          action,
          rootLocation: normalizedRoot,
          targetPath:
            resolved.normalizedRelativePath,
          message: `Directory created successfully: ${resolved.normalizedRelativePath}`,
        });
      }

      case "delete": {
        /*
         * Never permit this tool to delete the selected root directory.
         */
        if (
          resolved.normalizedRelativePath === "."
        ) {
          throw new Error(
            "Deleting rootLocation is not allowed.",
          );
        }

        await remove(targetPath, {
          recursive,
        });

        return serializeResult({
          success: true,
          action,
          rootLocation: normalizedRoot,
          targetPath:
            resolved.normalizedRelativePath,
          message: `Item deleted successfully: ${resolved.normalizedRelativePath}`,
        });
      }

      case "list": {
        const result =
          await listDirectoryContents({
            rootLocation: normalizedRoot,
            targetPath,
            recursive,
            maxResults,
          });

        return serializeResult({
          success: true,
          action,
          rootLocation: normalizedRoot,
          targetPath:
            resolved.normalizedRelativePath,
          message: `Found ${result.items.length} item(s).`,
          items: result.items,
          truncated: result.truncated,
        });
      }

      case "search": {
        const query = input.query?.trim();

        if (!query) {
          throw new Error(
            "query is required for search.",
          );
        }

        const result = await searchDirectory({
          rootLocation: normalizedRoot,
          targetPath,
          query,
          recursive,
          maxResults,
        });

        return serializeResult({
          success: true,
          action,
          rootLocation: normalizedRoot,
          targetPath:
            resolved.normalizedRelativePath,
          message: `Found ${result.items.length} matching item(s) for "${query}".`,
          items: result.items,
          truncated: result.truncated,
        });
      }

      case "read_file": {
        if (
          resolved.normalizedRelativePath === "."
        ) {
          throw new Error(
            "read_file requires a relative file path.",
          );
        }

        const content = await readTextFile(targetPath);

        return serializeResult({
          success: true,
          action,
          rootLocation: normalizedRoot,
          targetPath:
            resolved.normalizedRelativePath,
          message: `File read successfully: ${resolved.normalizedRelativePath}`,
          content,
        });
      }

      default: {
        const unreachableAction: never = action;

        throw new Error(
          `Unsupported action: ${String(unreachableAction)}`,
        );
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : String(error);

    return serializeResult({
      success: false,
      action,
      rootLocation: normalizedRoot,
      targetPath,
      error: errorMessage,
    });
  }
}

/**
 * A low-level filesystem tool available only to the internal file agent.
 *
 * The tool is intentionally action-based so the internal agent only
 * needs one tool for the first set of filesystem operations.
 */
export const folderOperationsTool = tool(
  executeFolderOperation,
  {
    name: "folder_operations",
    description: `
Perform basic file and directory operations inside a selected root location.

Supported actions:
- create_folder: create a directory
- delete: delete a file or directory
- list: list directory contents
- search: search file and directory names
- read_file: read a UTF-8 text file

Security rules:
- rootLocation must be the absolute folder selected by the user.
- path must always be relative to rootLocation.
- Use "." to represent rootLocation.
- Never place an absolute path inside path.
- Parent traversal using ".." is rejected.
- Deleting rootLocation itself is forbidden.
- Symlink directories are not recursively traversed.

For search, provide query and normally set recursive to true.
For recursive directory deletion, recursive must be true.
`.trim(),
    schema: folderOperationsInputSchema,
  },
);