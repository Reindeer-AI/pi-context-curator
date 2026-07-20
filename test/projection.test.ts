import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { segmentContext } from "../src/blocks.js";
import {
  inventoryBlocks,
  makePlans,
  mergeHiddenPlans,
  projectMessages,
} from "../src/projection.js";
import type { CuratedBlockPlan, PersistedCurationState } from "../src/types.js";

function user(text: string, timestamp: number): AgentMessage {
  return { role: "user", content: text, timestamp } as AgentMessage;
}

function stateFor(plans: CuratedBlockPlan[]): PersistedCurationState {
  return {
    version: 1,
    enabled: true,
    createdAt: new Date(0).toISOString(),
    beforeApproxTokens: plans.reduce((sum, plan) => sum + plan.approxTokens, 0),
    afterApproxTokens: 0,
    blocks: plans,
  };
}

function plan(id: string, action: CuratedBlockPlan["action"], tokens: number): CuratedBlockPlan {
  return {
    id,
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    reason: "test",
    suggestedAction: action,
    action,
    importance: 50,
    approxTokens: tokens,
    messageCount: 1,
  };
}

describe("projectMessages", () => {
  it("drops and summarizes selected blocks while leaving unknown future blocks intact", () => {
    const messages = [user("obsolete", 1), user("compress me", 2), user("future", 3)];
    const blocks = segmentContext(messages);
    const state = stateFor([
      plan(blocks[0]!.id, "drop", blocks[0]!.approxTokens),
      plan(blocks[1]!.id, "summarize", blocks[1]!.approxTokens),
    ]);

    const projected = projectMessages(messages, state);

    expect(projected.messages).toHaveLength(2);
    expect(projected.messages[0]?.role).toBe("custom");
    expect((projected.messages[0] as { content?: string }).content).toContain("Summary");
    expect(projected.messages[1]).toEqual(messages[2]);
    expect(projected.stats.droppedBlocks).toBe(1);
    expect(projected.stats.summarizedBlocks).toBe(1);
    expect(projected.stats.keptBlocks).toBe(1);
  });

  it("returns the original projection when disabled", () => {
    const messages = [user("keep me", 1)];
    const block = segmentContext(messages)[0]!;
    const state = { ...stateFor([plan(block.id, "drop", block.approxTokens)]), enabled: false };

    expect(projectMessages(messages, state).messages).toEqual(messages);
  });

  it("keeps pinned blocks protected while ordinary kept blocks can receive new recommendations", () => {
    const messages = [user("protected", 1), user("reconsider me", 2)];
    const blocks = segmentContext(messages);
    const previous = stateFor([
      plan(blocks[0]!.id, "pin", blocks[0]!.approxTokens),
      plan(blocks[1]!.id, "keep", blocks[1]!.approxTokens),
    ]);
    const analyses = blocks.map((block) => ({
      id: block.id,
      title: block.fallbackTitle,
      summary: block.fallbackTitle,
      reason: "new recommendation",
      suggestedAction: "drop" as const,
      importance: 10,
    }));

    const refreshed = makePlans(blocks, analyses, previous);
    expect(refreshed.map((item) => item.action)).toEqual(["pin", "drop"]);

    const editing = makePlans(blocks, analyses, previous, { reusePreviousActions: true });
    expect(editing.map((item) => item.action)).toEqual(["pin", "keep"]);
  });

  it("builds a new inventory from the current projection instead of resurfacing pruned blocks", () => {
    const messages = [user("already dropped", 1), user("already summarized", 2), user("still raw", 3)];
    const rawBlocks = segmentContext(messages);
    const previous = stateFor([
      plan(rawBlocks[0]!.id, "drop", rawBlocks[0]!.approxTokens),
      plan(rawBlocks[1]!.id, "summarize", rawBlocks[1]!.approxTokens),
      plan(rawBlocks[2]!.id, "keep", rawBlocks[2]!.approxTokens),
    ]);

    const visible = inventoryBlocks(messages, previous);
    expect(visible.map((block) => block.id)).toEqual([rawBlocks[1]!.id, rawBlocks[2]!.id]);
    expect(visible[0]?.messages[0]?.role).toBe("custom");

    const updatedVisiblePlans = [
      plan(rawBlocks[1]!.id, "summarize", visible[0]!.approxTokens),
      plan(rawBlocks[2]!.id, "pin", visible[1]!.approxTokens),
    ];
    const merged = mergeHiddenPlans(rawBlocks, updatedVisiblePlans, previous);
    expect(merged.map((item) => item.action)).toEqual(["drop", "summarize", "pin"]);

    const projected = projectMessages(messages, stateFor(merged));
    expect(projected.messages).toHaveLength(2);
    expect(projected.messages[0]?.role).toBe("custom");
    expect(projected.messages[1]).toEqual(messages[2]);
  });
});
