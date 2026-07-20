import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { buildFinalizedSummary } from "../src/finalize.js";
import type { ContextBlock, CuratedBlockPlan, PersistedCurationState } from "../src/types.js";

function plan(id: string, action: CuratedBlockPlan["action"]): CuratedBlockPlan {
  return {
    id,
    title: `Title "${id}"`,
    summary: `Summary ${id}`,
    reason: "test",
    suggestedAction: action,
    action,
    importance: 50,
    approxTokens: 10,
    messageCount: 1,
  };
}

function block(id: string, text: string): ContextBlock {
  return {
    id,
    index: 0,
    messages: [{ role: "user", content: text, timestamp: 1 } as AgentMessage],
    approxTokens: 10,
    fallbackTitle: id,
    startTimestamp: 1,
  };
}

describe("finalized projection", () => {
  it("materializes retained content and omits dropped blocks", () => {
    const state: PersistedCurationState = {
      version: 1,
      enabled: true,
      createdAt: new Date(0).toISOString(),
      beforeApproxTokens: 100,
      afterApproxTokens: 40,
      blocks: [plan("pinned", "pin"), plan("short", "summarize"), plan("gone", "drop")],
    };
    const blocks = new Map([
      ["pinned", block("pinned", "exact retained requirement")],
      ["gone", block("gone", "must not survive")],
    ]);

    const summary = buildFinalizedSummary(state, (id) => blocks.get(id));

    expect(summary).toContain("exact retained requirement");
    expect(summary).toContain("Summary short");
    expect(summary).toContain('context_recall({ block_id: "short" })');
    expect(summary).not.toContain("must not survive");
    expect(summary).not.toContain("Summary gone");
    expect(summary).toContain("&quot;pinned&quot;");
  });
});
