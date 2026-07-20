import type { Message } from "@earendil-works/pi-ai";
import {
  buildSessionContext,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { segmentContext } from "../src/blocks.js";
import { findRecallBlock } from "../src/index.js";
import { CURATOR_STATE_ENTRY } from "../src/state.js";
import type { PersistedCurationState } from "../src/types.js";

describe("recall resolution", () => {
  it("rebuilds the historical compaction-aware context used to create a block id", () => {
    const sessionManager = SessionManager.inMemory();
    const oldUserId = sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "old raw turn" }],
      timestamp: 1,
    } satisfies Message);
    const firstCompactionId = sessionManager.appendCompaction(
      "first compacted context",
      oldUserId,
      1_000,
    );

    const historicalMessages = buildSessionContext(
      sessionManager.getEntries(),
      firstCompactionId,
    ).messages;
    const compactedBlock = segmentContext(historicalMessages)[0]!;
    const state: PersistedCurationState = {
      version: 1,
      enabled: true,
      createdAt: new Date(0).toISOString(),
      sourceLeafId: firstCompactionId,
      beforeApproxTokens: 100,
      afterApproxTokens: 20,
      blocks: [],
    };
    const stateEntryId = sessionManager.appendCustomEntry(CURATOR_STATE_ENTRY, state);
    sessionManager.appendCompaction("second compacted context", stateEntryId, 500);

    const currentIds = segmentContext(sessionManager.buildSessionContext().messages).map(
      (block) => block.id,
    );
    expect(currentIds).not.toContain(compactedBlock.id);

    const recalled = findRecallBlock({ sessionManager }, compactedBlock.id);
    expect(recalled?.id).toBe(compactedBlock.id);
    expect(recalled?.messages[0]?.role).toBe("compactionSummary");
  });
});
