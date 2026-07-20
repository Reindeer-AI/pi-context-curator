import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { segmentContext } from "../src/blocks.js";

function user(text: string, timestamp: number): AgentMessage {
  return { role: "user", content: text, timestamp } as AgentMessage;
}

function assistant(text: string, timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  } as AgentMessage;
}

describe("segmentContext", () => {
  it("groups each user turn with the following assistant/tool messages", () => {
    const blocks = segmentContext([
      user("Investigate auth", 1),
      assistant("Reading the gateway", 2),
      { role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "large output" }], isError: false, timestamp: 3 } as AgentMessage,
      user("Now build it", 4),
      assistant("Implemented", 5),
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.messages).toHaveLength(3);
    expect(blocks[1]?.messages).toHaveLength(2);
    expect(blocks[0]?.fallbackTitle).toBe("Investigate auth");
    expect(blocks[1]?.fallbackTitle).toBe("Now build it");
  });

  it("keeps a stable block id when tool output changes", () => {
    const first = segmentContext([
      user("Investigate auth", 10),
      { role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "one" }], isError: false, timestamp: 11 } as AgentMessage,
    ]);
    const second = segmentContext([
      user("Investigate auth", 10),
      { role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "changed" }], isError: false, timestamp: 11 } as AgentMessage,
    ]);

    expect(first[0]?.id).toBe(second[0]?.id);
  });
});
