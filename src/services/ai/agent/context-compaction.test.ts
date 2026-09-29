import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { compactAgentContext } from "./context-compaction";

describe("compactAgentContext", () => {
  it("keeps only recent turns plus a bounded index for older history", () => {
    const messages: import("@langchain/core/messages").BaseMessage[] = [new SystemMessage("system")];
    for (let turn = 1; turn <= 7; turn += 1) {
      messages.push(new HumanMessage(`request-${turn}`));
      messages.push(new AIMessage(`answer-${turn}-${"x".repeat(3_000)}`));
    }

    compactAgentContext(messages);

    const text = messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n");
    expect(messages[0]).toBeInstanceOf(SystemMessage);
    expect(text).toContain("request-7");
    expect(text).toContain("request-6");
    expect(text).toContain("Earlier conversation and tool activity summarized");
    expect(text).not.toContain(`answer-1-${"x".repeat(2_500)}`);
    expect(text.length).toBeLessThan(20_000);
  });

  it("keeps the latest user request and matched recent tool-call/result batches", () => {
    const messages: import("@langchain/core/messages").BaseMessage[] = [new SystemMessage("system")];
    messages.push(new HumanMessage("do lots of work"));
    for (let call = 0; call < 16; call += 1) {
      const id = `tool-${call}`;
      messages.push(new AIMessage({
        content: "",
        tool_calls: [{ id, name: "read_file", args: { path: `file-${call}` }, type: "tool_call" }],
      }));
      messages.push(new ToolMessage({ content: `result-${call}-${"r".repeat(4_000)}`, tool_call_id: id, name: "read_file" }));
    }

    compactAgentContext(messages);

    const callIds = messages.flatMap((message) =>
      message instanceof AIMessage ? (message.tool_calls ?? []).map((call) => call.id) : [],
    );
    const resultIds = messages.flatMap((message) =>
      message instanceof ToolMessage ? [message.tool_call_id] : [],
    );
    const text = messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n");

    expect(text).toContain("do lots of work");
    expect(text).toContain("Earlier tool activity in the current turn summarized");
    expect(callIds.length).toBeGreaterThan(0);
    expect(callIds).toEqual(resultIds);
    expect(text).toContain("result-15-");
    expect(text.length).toBeLessThan(60_000);
  });

  it("is idempotent once context has been compacted", () => {
    const messages: import("@langchain/core/messages").BaseMessage[] = [new SystemMessage("system")];
    for (let turn = 0; turn < 10; turn += 1) {
      messages.push(new HumanMessage(`request-${turn}`));
      messages.push(new AIMessage(`answer-${turn}-${"x".repeat(3_000)}`));
    }

    compactAgentContext(messages);
    const once = messages.map((message) => JSON.stringify(message.toDict()));
    compactAgentContext(messages);
    const twice = messages.map((message) => JSON.stringify(message.toDict()));

    expect(twice).toEqual(once);
  });
});
