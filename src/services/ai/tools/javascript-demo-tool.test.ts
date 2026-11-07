import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  appDataDir: vi.fn(async () => "C:/app-data"),
  exists: vi.fn(async (path: string) => mocks.files.has(path)),
  mkdir: vi.fn(async () => undefined),
  readTextFile: vi.fn(async (path: string) => {
    const content = mocks.files.get(path);
    if (content === undefined) throw new Error("not found");
    return content;
  }),
  writeTextFile: vi.fn(async (path: string, content: string) => { mocks.files.set(path, content); }),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

vi.mock("@tauri-apps/api/path", () => ({ appDataDir: mocks.appDataDir, join: mocks.join }));
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: mocks.exists, mkdir: mocks.mkdir, readTextFile: mocks.readTextFile, writeTextFile: mocks.writeTextFile }));

import {
  appendJavaScriptDemoEmbeds,
  compactJavaScriptDemoToolCalls,
  getJavaScriptDemo,
  hideStreamingMocuJsSource,
  persistJavaScriptDemoToolCalls,
  prepareJavaScriptDemoAnswer,
} from "../../../chat/services/javascriptDemoRegistry";
import { createJavaScriptDemoTool } from "./javascript-demo-tool";

const javascriptDemoTool = createJavaScriptDemoTool("C:/project");

describe("run_javascript_demo tool", () => {
  beforeEach(() => {
    mocks.files.clear();
    vi.clearAllMocks();
    delete (globalThis as { __demoMustNotExecute?: boolean }).__demoMustNotExecute;
  });

  it("persists the source file in project storage and returns only an opaque reference", async () => {
    const source = "globalThis.__demoMustNotExecute = true;";
    const result = await javascriptDemoTool.invoke({
      title: "A test preview",
      javascript: source,
      css: "#root { color: red; }",
      height: 420,
    });

    expect(result).toMatch(/^mocu-interactive-js:[A-Za-z0-9-]+$/);
    expect(result).not.toContain(source);
    expect((globalThis as { __demoMustNotExecute?: boolean }).__demoMustNotExecute).toBeUndefined();

    const id = result.slice("mocu-interactive-js:".length);
    expect(getJavaScriptDemo(id)).toMatchObject({
      title: "A test preview",
      javascript: source,
      css: "#root { color: red; }",
      height: 420,
    });
    expect([...mocks.files.values()].join(" ")).toContain(source);
    expect([...mocks.files.keys()][0]).toContain("C:/project/.mocu/interactive-js-demos/");
  });

  it("reloads the persisted file in a fresh registry after an app restart", async () => {
    const result = await javascriptDemoTool.invoke({ javascript: "root.textContent = 'survives restart';" });
    const id = result.slice("mocu-interactive-js:".length);
    expect(getJavaScriptDemo(id)?.javascript).toBe("root.textContent = 'survives restart';");

    vi.resetModules();
    const restartedRegistry = await import("../../../chat/services/javascriptDemoRegistry");
    expect(await restartedRegistry.loadJavaScriptDemo(id, "C:/project")).toMatchObject({
      id,
      javascript: "root.textContent = 'survives restart';",
    });
  });

  it("persists pending tool-call source and compacts the resumable checkpoint", async () => {
    const source = "root.textContent = 'recovered';";
    const original = {
      tool_calls: [{ name: "run_javascript_demo", args: { javascript: source, css: ".a{}", title: "Recovery", height: 360 } }],
    };
    const persisted = await persistJavaScriptDemoToolCalls(original, "C:/project");
    expect(persisted.tool_calls?.[0].args).toEqual({ savedDemoReference: expect.stringMatching(/^mocu-interactive-js:/) });
    expect(JSON.stringify(persisted)).not.toContain(source);
    expect([...mocks.files.values()].join(" ")).toContain(source);

    const reference = (persisted.tool_calls?.[0].args as unknown as { savedDemoReference: string }).savedDemoReference;
    const resumedResult = await javascriptDemoTool.invoke({ savedDemoReference: reference });
    expect(resumedResult).toBe(reference);
    expect(mocks.writeTextFile).toHaveBeenCalledOnce();
  });


  it("accepts compatibility source fields and returns a reference", async () => {
    const result = await javascriptDemoTool.invoke({ source: "root.textContent = 'alias';" });
    expect(result).toMatch(/^mocu-interactive-js:/);
    const id = result.slice("mocu-interactive-js:".length);
    expect(getJavaScriptDemo(id)?.javascript).toBe("root.textContent = 'alias';");
  });

  it("returns a recoverable message for incomplete input instead of a schema exception", async () => {
    await expect(javascriptDemoTool.invoke({ title: "Missing source" })).resolves.toContain(
      "Retry run_javascript_demo with the complete source in the javascript field",
    );
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("compacts demo calls only when their result includes a saved reference", () => {
    const message = {
      tool_calls: [
        { id: "ok", name: "run_javascript_demo", args: { javascript: "source" } },
        { id: "failed", name: "run_javascript_demo", args: { javascript: "keep for retry" } },
      ],
    };
    const compacted = compactJavaScriptDemoToolCalls(message, [
      { tool_call_id: "ok", content: "mocu-interactive-js:demo-42" },
      { tool_call_id: "failed", content: "No JavaScript source was provided." },
    ]);
    expect(compacted.tool_calls?.[0].args).toEqual({ savedDemoReference: "mocu-interactive-js:demo-42" });
    expect(compacted.tool_calls?.[1].args).toEqual({ javascript: "keep for retry" });
  });

  it("rejects oversized source instead of saving it", async () => {
    await expect(javascriptDemoTool.invoke({ javascript: "x".repeat(30_001) })).rejects.toThrow();
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("automatically saves direct mocu-js response blocks and exposes only references", async () => {
    const source = "root.textContent = 'saved automatically';";
    const prepared = await prepareJavaScriptDemoAnswer(
      `Demo:\n\n\`\`\`mocu-js\n${source}\n\`\`\``,
      [],
      "C:/project",
    );
    expect(prepared).toMatch(/^Demo:\n\n\`\`\`mocu-js\nmocu-interactive-js:[A-Za-z0-9-]+\n\`\`\`$/);
    expect(prepared).not.toContain(source);
    expect([...mocks.files.values()].join(" ")).toContain(source);
  });

  it("falls back to persistent global storage and resolves that reference from project chats", async () => {
    mocks.mkdir.mockImplementationOnce(async () => { throw new Error("project folder is read-only"); });
    const result = await javascriptDemoTool.invoke({ javascript: "root.textContent = 'global fallback';" });
    const id = result.slice("mocu-interactive-js:".length);
    expect([...mocks.files.keys()][0]).toContain("C:/app-data/interactive-js-demos/");
    vi.resetModules();
    const restartedRegistry = await import("../../../chat/services/javascriptDemoRegistry");
    expect(await restartedRegistry.loadJavaScriptDemo(id, "C:/project")).toMatchObject({ javascript: "root.textContent = 'global fallback';" });
  });

  it("redacts source from streamed mocu-js blocks", () => {
    const rendered = hideStreamingMocuJsSource("Before\n\n\`\`\`mocu-js\nsecret source\n\`\`\`\nAfter");
    expect(rendered).not.toContain("secret source");
    expect(rendered).toContain("Preparing preview...");
    expect(rendered).toContain("Before");
    expect(rendered).toContain("After");
  });

  it("adds only short references to the final answer", () => {
    const first = "mocu-interactive-js:demo-1";
    const second = "mocu-interactive-js:demo-2";
    expect(appendJavaScriptDemoEmbeds("Here is the demo.", [
      `[run_javascript_demo]\\n${first}`,
      `[run_javascript_demo]\\n${second}`,
    ])).toBe(`Here is the demo.\n\n\`\`\`mocu-js\n${first}\n\`\`\`\n\n\`\`\`mocu-js\n${second}\n\`\`\``);
    expect(appendJavaScriptDemoEmbeds("Answer", ["[other_tool]\n" + first])).toBe("Answer");
    expect(appendJavaScriptDemoEmbeds("```mocu-js\nmocu-interactive-js:invented-id\n```", [
      "[run_javascript_demo]\nNo JavaScript source was provided.",
    ])).toBe("");
    expect(appendJavaScriptDemoEmbeds("```mocu-js\nmocu-interactive-js:demo-1\n```", [
      "[run_javascript_demo]\nmocu-interactive-js:demo-1",
    ])).toBe("```mocu-js\nmocu-interactive-js:demo-1\n```");
  });
});
