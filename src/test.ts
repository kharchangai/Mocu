// // import { shouldRouteToGraphSystem } from "./graphStructure/jevGate";
// import { createGraphRecorder } from "./graphStructure/recorder";
// import { buildGraph } from "./graphStructure/graphMaker";
// import { cleanRunRecords } from "./graphStructure/cleanup";
// import {
//   buildRunGraphEmbeddingText,
//   buildRunGraphSearchable,
//   listRunGraphs,
//   loadRunGraph,
//   saveRunGraph,
// } from "./graphStructure/graphStorage";
// import { searchRunGraphs } from "./graphStructure/graphSearch";
// import { createGraphTools } from "./graphStructure/graphTools";
// import { ToolExecutor } from "./services/ai/agent/tool-executor";

export async function runTest(): Promise<void> {
  // // const userMessage =
  // //   "لطفا ساختار فایل‌های این پروژه را بررسی کن و فایل تنظیمات را پیدا کن";

  // // console.log("[jevGate test] userMessage:", userMessage);

  // // try {
  // //   const needsSystem = await shouldRouteToGraphSystem(userMessage);
  // //   console.log("[jevGate test] needs full system path:", needsSystem);
  // // } catch (error) {
  // //   console.error("[jevGate test] Failed:", error);
  // // }

  // // --- GraphRecorder + GraphMaker demo ---
  // const recorder = createGraphRecorder({
  //   agentKind: "chat",
  //   chatId: "chat-1",
  // });

  // // Simulates what an agent would record for one user message.
  // recorder.startRun("برو ساختار پروژه را بررسی کن");

  // recorder.recordModelCall({
  //   thought: "باید اول فایل‌ها را ببینم",
  //   text: "",
  //   hasToolCalls: true,
  // });

  // recorder.recordToolCall({
  //   id: "call-1",
  //   tool: "find_file",
  //   args: { pattern: "config" },
  //   status: "running",
  // });
  // recorder.recordToolCall({
  //   id: "call-1",
  //   tool: "find_file",
  //   args: { pattern: "config" },
  //   result: "vite.config.ts",
  //   status: "done",
  // });

  // // Repeats the same tool+args: cleanup should drop it as duplicate
  // // without asking JEV again.
  // recorder.recordToolCall({
  //   id: "call-2",
  //   tool: "find_file",
  //   args: { pattern: "config" },
  //   result: "vite.config.ts",
  //   status: "done",
  // });

  // recorder.recordModelCall({
  //   text: "فایل تنظیمات vite.config.ts پیدا شد",
  //   hasToolCalls: false,
  // });

  // recorder.finishRun("فایل تنظیمات vite.config.ts پیدا شد.");

  // const rawGraph = buildGraph(recorder);

  // console.log("[graph demo] nodes:");
  // for (const node of rawGraph.nodes) {
  //   console.log(`  - [${node.kind}] ${node.id} "${node.label}"`);
  // }
  // console.log("[graph demo] edges:");
  // for (const edge of rawGraph.edges) {
  //   console.log(`  - ${edge.type}: ${edge.from} -> ${edge.to}`);
  // }

  // // --- JEV cleanup demo ---
  // // Filters the raw records: model calls are dropped by rule and each
  // // tool call is judged one by one by JEV (usefulForRun / usefulForStructure).
  // let cleanedGraph: Parameters<typeof saveRunGraph>[1] | null = null;
  // try {
  //   const cleanup = await cleanRunRecords(recorder.getRecords());

  //   console.log("[cleanup] decisions:");
  //   for (const decision of cleanup.decisions) {
  //     const detail =
  //       decision.reason === "jev"
  //         ? `usefulForRun=${decision.usefulForRun?.toFixed(2)} usefulForStructure=${decision.usefulForStructure?.toFixed(2)}`
  //         : decision.reason === "jev_error"
  //           ? `error: ${decision.error}`
  //           : "";
  //     console.log(
  //       `  - ${decision.recordId} [${decision.tool ?? "model"}] -> ${decision.keep ? "KEEP" : "DROP"} (${decision.reason})${detail ? ` ${detail}` : ""}`,
  //     );
  //   }

  //   const cleanedRecorder = {
  //     runId: recorder.runId,
  //     agentKind: recorder.agentKind,
  //     chatId: recorder.chatId,
  //     getRecords: () => cleanup.kept,
  //   } as Parameters<typeof buildGraph>[0];

  //   const graph = buildGraph(cleanedRecorder);
  //   console.log("[cleanup] persisted graph nodes:");
  //   for (const node of graph.nodes) {
  //     console.log(`  - [${node.kind}] ${node.id} "${node.label}"`);
  //   }
  //   console.log(
  //     `[cleanup] kept ${cleanup.kept.length}, dropped ${cleanup.dropped.length}`,
  //   );
  //   cleanedGraph = graph;
  // } catch (error) {
  //   console.error("[cleanup demo] Failed:", error);
  // }

  // // --- Graph storage demo ---
  // // Saves the cleaned graph into the PROJECT database
  // // (<project>/.mocu/storage/memory.db) and best-effort embeds it.
  // if (cleanedGraph) {
  //   const searchable = buildRunGraphSearchable(cleanedGraph);
  //   console.log("[storage] searchable:");
  //   console.log(`  - userMessage: ${searchable.userMessage}`);
  //   console.log(`  - finalAnswer: ${searchable.finalAnswer}`);
  //   console.log(`  - toolSummary: ${searchable.toolSummary}`);
  //   console.log("[storage] embedding text:");
  //   console.log(
  //     buildRunGraphEmbeddingText(searchable)
  //       .split("\n")
  //       .map((line) => `  | ${line}`)
  //       .join("\n"),
  //   );

  //   // Pick a project folder to write into; override with your own path
  //   // when running inside the real app. (process is undefined in the
  //   // webview build, hence the typeof guard.)
  //   const projectPath =
  //     (typeof process !== "undefined" &&
  //       process.env?.MOCU_TEST_PROJECT_PATH) ||
  //     "E:/mocube/mocu";

  //   try {
  //     const saved = await saveRunGraph(projectPath, cleanedGraph);
  //     console.log(
  //       `[storage] saved key=${saved.key} embedded=${saved.embedded}` +
  //         (saved.embedError ? ` embedError: ${saved.embedError}` : ""),
  //     );

  //     const loaded = await loadRunGraph(projectPath, saved.key);
  //     console.log(
  //       `[storage] loaded: nodes=${loaded?.graph.nodes.length ?? "-"} embedding=${loaded?.embedding ? `yes (${loaded.embedding.length}d)` : "null"} model=${loaded?.embeddingModel ?? "-"}`,
  //     );

  //     const all = await listRunGraphs(projectPath);
  //     console.log(`[storage] project has ${all.length} run graph(s)`);

  //     // --- Graph search + agent tools demo (step 5) ---
  //     const searchQuery = "کجای پروژه تنظیمات vite پیدا می‌شود؟";
  //     const search = await searchRunGraphs(projectPath, searchQuery, {
  //       limit: 3,
  //     });
  //     console.log(
  //       `[search] query scoring=${search.scoring} total=${search.totalGraphs}` +
  //         (search.vectorError ? ` vectorError: ${search.vectorError}` : ""),
  //     );
  //     for (const match of search.matches) {
  //       console.log(
  //         `  - ${match.runId} score=${match.score.toFixed(4)} method=${match.method} "${match.searchable.userMessage}"`,
  //       );
  //     }

  //     // Same tools an agent will receive in step 6, executed through
  //     // the real ToolExecutor.
  //     const executor = new ToolExecutor();
  //     for (const tool of createGraphTools()) {
  //       executor.registerTool(tool);
  //     }
  //     console.log(
  //       `[tools] registered: ${executor
  //         .getAvailableTools()
  //         .map((tool) => tool.name)
  //         .join(", ")}`,
  //     );

  //     const searchToolResult = await executor.execute("search_run_graph", {
  //       query: searchQuery,
  //       limit: 3,
  //       projectPath,
  //     });
  //     console.log("[tools] search_run_graph:", searchToolResult);

  //     const getToolResult = await executor.execute("get_run_graph", {
  //       runId: saved.key,
  //       projectPath,
  //     });
  //     console.log("[tools] get_run_graph:", getToolResult);
  //   } catch (error) {
  //     console.error("[storage demo] Failed:", error);
  //   }
  // }
}