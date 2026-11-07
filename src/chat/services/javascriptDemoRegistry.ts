import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export type JavaScriptDemo = {
  id: string;
  title: string;
  javascript: string;
  css: string;
  height: number;
};

const MAX_CACHED_DEMOS = 40;
const demos = new Map<string, JavaScriptDemo>();
const STORAGE_KEY = "mocu:interactive-js-demos";
const GLOBAL_DEMO_DIRECTORY = "interactive-js-demos";
const PROJECT_DEMO_DIRECTORY = ".mocu/interactive-js-demos";

function createDemoId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function cacheDemo(demo: JavaScriptDemo): void {
  demos.set(demo.id, demo);
  while (demos.size > MAX_CACHED_DEMOS) {
    const oldestId = demos.keys().next().value;
    if (oldestId === undefined) break;
    demos.delete(oldestId);
  }
}

/** Persist complete source/metadata outside chat messages; return its opaque file reference. */
export async function saveJavaScriptDemo(
  demo: Omit<JavaScriptDemo, "id">,
  projectPath = "",
): Promise<string> {
  const id = createDemoId();
  const registered: JavaScriptDemo = { ...demo, id };
  const directories: string[] = [];
  if (projectPath.trim()) directories.push(await join(projectPath.trim(), PROJECT_DEMO_DIRECTORY));
  let lastError: unknown;
  for (const directory of directories) {
    try {
      const path = await join(directory, `${id}.json`);
      await mkdir(directory, { recursive: true });
      await writeTextFile(path, JSON.stringify(registered));
      cacheDemo(registered);
      return id;
    } catch (error) {
      lastError = error;
      console.warn(`[Interactive JavaScript] Could not save under ${directory}; falling back to global app data.`, error);
    }
  }
  try {
    const globalDirectory = await join(await appDataDir(), GLOBAL_DEMO_DIRECTORY);
    const path = await join(globalDirectory, `${id}.json`);
    await mkdir(globalDirectory, { recursive: true });
    await writeTextFile(path, JSON.stringify(registered));
    cacheDemo(registered);
    return id;
  } catch (error) {
    lastError = error;
  }
  throw lastError instanceof Error ? lastError : new Error("Could not persist interactive JavaScript preview.");
}

/** In-memory registration is retained for tests and legacy inline previews only. */
export function registerJavaScriptDemo(
  demo: Omit<JavaScriptDemo, "id">,
): string {
  const id = createDemoId();
  cacheDemo({ ...demo, id });
  return id;
}

export function getJavaScriptDemo(id: string): JavaScriptDemo | undefined {
  const inMemory = demos.get(id);
  if (inMemory) return inMemory;

  try {
    const saved = window.sessionStorage.getItem(`${STORAGE_KEY}:${id}`);
    if (!saved) return undefined;
    const parsed = JSON.parse(saved) as Partial<JavaScriptDemo>;
    if (!isJavaScriptDemo(parsed, id)) return undefined;
    const demo: JavaScriptDemo = {
      id,
      title: parsed.title,
      javascript: parsed.javascript,
      css: parsed.css,
      height: parsed.height,
    };
    cacheDemo(demo);
    return demo;
  } catch {
    return undefined;
  }
}

/** Loads a project-local or global persisted demo, including after an app restart. */
export async function loadJavaScriptDemo(
  id: string,
  projectPath = "",
): Promise<JavaScriptDemo | undefined> {
  const inMemory = getJavaScriptDemo(id);
  if (inMemory) return inMemory;

  try {
    const directories = projectPath.trim()
      ? [
          await join(projectPath.trim(), PROJECT_DEMO_DIRECTORY),
          await join(await appDataDir(), GLOBAL_DEMO_DIRECTORY),
        ]
      : [await join(await appDataDir(), GLOBAL_DEMO_DIRECTORY)];
    for (const directory of directories) {
      try {
        const path = await join(directory, `${id}.json`);
        if (!(await exists(path))) continue;
        const parsed = JSON.parse(await readTextFile(path)) as Partial<JavaScriptDemo>;
        if (!isJavaScriptDemo(parsed, id)) continue;
        const demo: JavaScriptDemo = {
          id,
          title: parsed.title,
          javascript: parsed.javascript,
          css: parsed.css,
          height: parsed.height,
        };
        cacheDemo(demo);
        return demo;
      } catch (error) {
        console.warn(`[Interactive JavaScript] Could not load from ${directory}; checking the next storage location.`, error);
      }
    }
    return undefined;
  } catch (error) {
    console.error("[Interactive JavaScript] Failed to load the saved demo:", error);
    return undefined;
  }
}

function isJavaScriptDemo(
  value: Partial<JavaScriptDemo>,
  id: string,
): value is JavaScriptDemo {
  return value.id === id && typeof value.title === "string" &&
    typeof value.javascript === "string" && typeof value.css === "string" &&
    typeof value.height === "number";
}

/** This opaque file reference is the only demo-related text sent back to the model. */
export function createJavaScriptDemoReference(id: string): string {
  return `mocu-interactive-js:${id}`;
}

/**
 * Persist source written directly in mocu-js fences and replace it with a
 * reference before the answer is displayed, checkpointed, or added to memory.
 */
export async function persistMocuJsBlocks(
  answer: string,
  projectPath = "",
): Promise<{ answer: string; references: string[] }> {
  const pattern = /```mocu-js\s*\r?\n([\s\S]*?)```/gi;
  const matches = [...answer.matchAll(pattern)];
  if (!matches.length) return { answer, references: [] };

  const references: string[] = [];
  let output = "";
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? cursor;
    output += answer.slice(cursor, index);
    const source = (match[1] ?? "").trim();
    if (!source) {
      output += match[0];
    } else if (/^mocu-interactive-js:([A-Za-z0-9-]+)$/.test(source)) {
      const id = source.slice("mocu-interactive-js:".length);
      if (await loadJavaScriptDemo(id, projectPath)) references.push(source);
      output += match[0];
    } else {
      try {
        const id = await saveJavaScriptDemo({
          title: "Interactive JavaScript",
          javascript: source,
          css: "",
          height: 360,
        }, projectPath);
        const reference = createJavaScriptDemoReference(id);
        references.push(reference);
        output += `\`\`\`mocu-js\n${reference}\n\`\`\``;
      } catch (error) {
        console.error("[Interactive JavaScript] Failed to save preview source:", error);
        output += "Interactive preview could not be saved. Please try again.";
      }
    }
    cursor = index + match[0].length;
  }
  output += answer.slice(cursor);
  return { answer: output, references };
}

/** Save inline mocu-js source, replace it with references, then validate legacy tool references. */
export async function prepareJavaScriptDemoAnswer(
  answer: string,
  toolResults: string[],
  projectPath = "",
): Promise<string> {
  const persisted = await persistMocuJsBlocks(answer, projectPath);
  const verifiedResults = [
    ...toolResults,
    ...persisted.references.map((reference) => `[run_javascript_demo]\n${reference}`),
  ];
  return appendJavaScriptDemoEmbeds(persisted.answer, verifiedResults);
}

/** Keep source out of live answer/activity previews while a mocu-js block streams. */
export function hideStreamingMocuJsSource(text: string): string {
  return text.replace(/```mocu-js\b[^\n]*\n[\s\S]*?(?:```|$)/gi, (block) => {
    const closed = block.endsWith("```");
    return `\`\`\`mocu-js\nPreparing preview...${closed ? "\n\`\`\`" : ""}`;
  });
}

/** Keep only opaque references in the visible answer; never append demo source. */
export function appendJavaScriptDemoEmbeds(
  answer: string,
  toolResults: string[],
): string {
  const references = new Set<string>();
  for (const result of toolResults) {
    if (!/\[(?:run_javascript_demo|Tool result: run_javascript_demo)\]/.test(result)) continue;
    for (const match of result.matchAll(/mocu-interactive-js:([A-Za-z0-9-]+)/g)) {
      references.add(`mocu-interactive-js:${match[1]}`);
    }
  }

  let output = answer.replace(/```mocu-js\s*([\s\S]*?)```/gi, (_block, body: string) => {
    const reference = body.trim().match(/^mocu-interactive-js:[A-Za-z0-9-]+$/)?.[0];
    return reference && references.has(reference) ? `\`\`\`mocu-js\n${reference}\n\`\`\`` : "";
  }).trim();
  const missing = [...references].filter((reference) => !output.includes(reference));
  if (missing.length > 0) {
    output = [output, ...missing.map((reference) => `\`\`\`mocu-js\n${reference}\n\`\`\``)]
      .filter(Boolean)
      .join("\n\n");
  }
  return output;
}

/** Keep bulky source out of tool activity and project-memory records. */
export function getJavaScriptDemoActivityArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(typeof args.title === "string" ? { title: args.title } : {}),
    ...(typeof args.height === "number" ? { height: args.height } : {}),
    sourceStoredExternally: true,
  };
}

/** Reduce persisted/provider-facing tool calls after the source file has been saved. */
type JavaScriptDemoToolResult = {
  tool_call_id?: string;
  content?: unknown;
};

function getSavedDemoReference(content: unknown): string | undefined {
  const serialized = typeof content === "string" ? content : JSON.stringify(content ?? "");
  return serialized.match(/mocu-interactive-js:[A-Za-z0-9-]+/)?.[0];
}

/**
 * Drop large source only after the matching tool result proves it was saved.
 * This keeps replayable assistant calls valid and prevents a failed/incomplete
 * call from being turned into an argument-less checkpoint.
 */
export function compactJavaScriptDemoToolCalls<T extends { tool_calls?: Array<{ id?: string; name: string; args: unknown }> }>(
  message: T,
  toolResults: JavaScriptDemoToolResult[] = [],
): T {
  if (!Array.isArray(message.tool_calls)) return message;
  const tool_calls = message.tool_calls.map((call) => {
    if (call.name !== "run_javascript_demo") return call;
    const args = (call.args ?? {}) as Record<string, unknown>;
    const result = toolResults.find((item) => item.tool_call_id === call.id);
    const savedReference = typeof args.savedDemoReference === "string"
      ? args.savedDemoReference
      : result ? getSavedDemoReference(result.content) : undefined;
    if (savedReference) return { ...call, args: { savedDemoReference: savedReference } };
    // Retain the original arguments on failure or while a partial call is incomplete.
    return call;
  });
  return Object.assign(Object.create(Object.getPrototypeOf(message)) as T, message, { tool_calls });
}

/** Persist pending project-chat demo calls before they enter a resumable snapshot. */
function getJavaScriptSource(args: Record<string, unknown>): string | undefined {
  for (const key of ["javascript", "source", "code", "sourceCode", "javascriptCode", "javascript_source", "source_code", "js", "demoCode"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export async function persistJavaScriptDemoToolCalls<T extends { tool_calls?: Array<{ name: string; args: unknown }> }>(
  message: T,
  projectPath: string,
): Promise<T> {
  if (!Array.isArray(message.tool_calls)) return message;
  const tool_calls = await Promise.all(message.tool_calls.map(async (call) => {
    if (call.name !== "run_javascript_demo") return call;
    const args = (call.args ?? {}) as Record<string, unknown>;
    if (typeof args.savedDemoReference === "string") return call;
    const javascript = getJavaScriptSource(args);
    if (!javascript) return call;
    const id = await saveJavaScriptDemo({
      title: typeof args.title === "string" && args.title.trim() ? args.title.trim() : "Interactive JavaScript",
      javascript,
      css: typeof args.css === "string" ? args.css : "",
      height: typeof args.height === "number" ? args.height : 360,
    }, projectPath);
    return { ...call, args: { savedDemoReference: createJavaScriptDemoReference(id) } };
  }));
  return Object.assign(Object.create(Object.getPrototypeOf(message)) as T, message, { tool_calls });
}
