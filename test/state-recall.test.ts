import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { recallPage, serializeRecallBlock } from "../src/recall.js";
import { CURATOR_STATE_ENTRY, disabledState, restoreCurationState } from "../src/state.js";
import type { PersistedCurationState } from "../src/types.js";

const state: PersistedCurationState = {
  version: 1,
  enabled: true,
  createdAt: new Date(0).toISOString(),
  beforeApproxTokens: 100,
  afterApproxTokens: 20,
  blocks: [],
};

describe("curator state", () => {
  it("restores the latest valid branch entry", () => {
    const restored = restoreCurationState([
      { type: "custom", customType: CURATOR_STATE_ENTRY, data: state },
      { type: "custom", customType: CURATOR_STATE_ENTRY, data: disabledState(state) },
    ]);
    expect(restored?.enabled).toBe(false);
    expect(restored?.beforeApproxTokens).toBe(100);
  });
});

describe("recallPage", () => {
  it("paginates recalled content with a bounded limit", () => {
    const page = recallPage("abcdefghij", 2, 4);
    expect(page.text).toBe("cdef");
    expect(page.nextOffset).toBe(6);
    expect(page.totalChars).toBe(10);
  });

  it("serializes complete tool output rather than compaction-truncated text", () => {
    const result = "x".repeat(3_000);
    const text = serializeRecallBlock({
      id: "block",
      index: 0,
      approxTokens: 750,
      fallbackTitle: "tool",
      startTimestamp: 1,
      messages: [
        {
          role: "toolResult",
          toolCallId: "t1",
          toolName: "read",
          content: [{ type: "text", text: result }],
          isError: false,
          timestamp: 1,
        } as AgentMessage,
      ],
    });
    expect(text).toContain(result);
  });
});
