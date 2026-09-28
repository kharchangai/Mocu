// import { shouldRouteToGraphSystem } from "./graphStructure/jevGate";
import { createGraphRecorder } from "./graphStructure/recorder";
import { buildGraph } from "./graphStructure/graphMaker";

export async function runTest(): Promise<void> {
  // const userMessage =
  //   "لطفا ساختار فایل‌های این پروژه را بررسی کن و فایل تنظیمات را پیدا کن";

  // console.log("[jevGate test] userMessage:", userMessage);

  // try {
  //   const needsSystem = await shouldRouteToGraphSystem(userMessage);
  //   console.log("[jevGate test] needs full system path:", needsSystem);
  // } catch (error) {
  //   console.error("[jevGate test] Failed:", error);
  // }

  // --- GraphRecorder + GraphMaker demo ---
  const recorder = createGraphRecorder({
    agentKind: "chat",
    chatId: "chat-1",
  });

  // Simulates what an agent would record for one user message.
  recorder.startRun("برو ساختار پروژه را بررسی کن");

  recorder.recordModelCall({
    thought: "باید اول فایل‌ها را ببینم",
    text: "",
    hasToolCalls: true,
  });

  recorder.recordToolCall({
    id: "call-1",
    tool: "find_file",
    args: { pattern: "config" },
    status: "running",
  });
  recorder.recordToolCall({
    id: "call-1",
    tool: "find_file",
    args: { pattern: "config" },
    result: "vite.config.ts",
    status: "done",
  });

  recorder.recordModelCall({
    text: "فایل تنظیمات vite.config.ts پیدا شد",
    hasToolCalls: false,
  });

  recorder.finishRun("فایل تنظیمات vite.config.ts پیدا شد.");

  const graph = buildGraph(recorder);

  console.log("[graph demo] nodes:");
  for (const node of graph.nodes) {
    console.log(`  - [${node.kind}] ${node.id} "${node.label}"`);
  }
  console.log("[graph demo] edges:");
  for (const edge of graph.edges) {
    console.log(`  - ${edge.type}: ${edge.from} -> ${edge.to}`);
  }
}