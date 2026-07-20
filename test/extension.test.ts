import type { Message } from "@earendil-works/pi-ai";
import {
  SessionManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import contextCuratorExtension from "../src/index.js";
import { CURATOR_STATE_ENTRY, restoreCurationState } from "../src/state.js";
import type { CuratedBlockPlan, PersistedCurationState } from "../src/types.js";
import { segmentContext } from "../src/blocks.js";

function plan(id: string, action: CuratedBlockPlan["action"]): CuratedBlockPlan {
  return {
    id,
    title: id,
    summary: `summary ${id}`,
    reason: "test",
    suggestedAction: action,
    action,
    importance: 50,
    approxTokens: 10,
    messageCount: 1,
  };
}

describe("extension lifecycle", () => {
  it("shows active status and finalizes the projection through native compaction", async () => {
    const sessionManager = SessionManager.inMemory();
    const firstEntryId = sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "retain this" }],
      timestamp: 1,
    } satisfies Message);
    sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "drop this" }],
      timestamp: 2,
    } satisfies Message);
    const blocks = segmentContext(sessionManager.buildSessionContext().messages);
    const state: PersistedCurationState = {
      version: 1,
      enabled: true,
      createdAt: new Date(0).toISOString(),
      sourceLeafId: sessionManager.getLeafId()!,
      beforeApproxTokens: 100,
      afterApproxTokens: 20,
      blocks: [plan(blocks[0]!.id, "keep"), plan(blocks[1]!.id, "drop")],
    };
    const stateEntryId = sessionManager.appendCustomEntry(CURATOR_STATE_ENTRY, state);

    const handlers = new Map<string, Array<(...args: any[]) => Promise<any>>>();
    const statuses: Array<string | undefined> = [];
    const pi = {
      on(event: string, handler: (...args: any[]) => Promise<any>) {
        const existing = handlers.get(event) ?? [];
        existing.push(handler);
        handlers.set(event, existing);
      },
      appendEntry(customType: string, data: unknown) {
        return sessionManager.appendCustomEntry(customType, data);
      },
      registerCommand() {},
      registerTool() {},
    } as unknown as ExtensionAPI;
    contextCuratorExtension(pi);

    const ctx = {
      sessionManager,
      mode: "tui",
      model: undefined,
      ui: {
        theme: { fg: (_name: string, text: string) => text },
        setStatus: (_key: string, value: string | undefined) => statuses.push(value),
        notify() {},
      },
    };

    await handlers.get("session_start")![0]!({}, ctx);
    expect(statuses.at(-1)).toBe("curated -80%");

    const compactResult = await handlers.get("session_before_compact")![0]!(
      {
        reason: "manual",
        signal: new AbortController().signal,
        preparation: { tokensBefore: 100 },
      },
      ctx,
    );
    expect(compactResult.compaction.firstKeptEntryId).toBe(stateEntryId);
    expect(compactResult.compaction.summary).toContain("retain this");
    expect(compactResult.compaction.summary).not.toContain("drop this");

    const compactionId = sessionManager.appendCompaction(
      compactResult.compaction.summary,
      compactResult.compaction.firstKeptEntryId,
      compactResult.compaction.tokensBefore,
      compactResult.compaction.details,
      true,
    );
    await handlers.get("session_compact")![0]!(
      { compactionEntry: sessionManager.getEntry(compactionId) },
      ctx,
    );

    expect(restoreCurationState(sessionManager.getBranch())?.enabled).toBe(false);
    expect(statuses.at(-1)).toBeUndefined();
    expect(firstEntryId).toBeTruthy();
  });

  it("postpones threshold compaction only once even when the leaf changes", async () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "first turn" }],
      timestamp: 1,
    } satisfies Message);

    const handlers = new Map<string, Array<(...args: any[]) => Promise<any>>>();
    const notifications: string[] = [];
    const pi = {
      on(event: string, handler: (...args: any[]) => Promise<any>) {
        const existing = handlers.get(event) ?? [];
        existing.push(handler);
        handlers.set(event, existing);
      },
      appendEntry(customType: string, data: unknown) {
        return sessionManager.appendCustomEntry(customType, data);
      },
      registerCommand() {},
      registerTool() {},
    } as unknown as ExtensionAPI;
    contextCuratorExtension(pi);

    const ctx = {
      sessionManager,
      mode: "tui",
      model: undefined,
      ui: {
        theme: { fg: (_name: string, text: string) => text },
        setStatus() {},
        notify(message: string) {
          notifications.push(message);
        },
      },
    };
    const thresholdEvent = {
      reason: "threshold",
      signal: new AbortController().signal,
      preparation: { tokensBefore: 100 },
    };

    await handlers.get("session_start")![0]!({}, ctx);
    const first = await handlers.get("session_before_compact")![0]!(thresholdEvent, ctx);
    expect(first).toEqual({ cancel: true });

    sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "new leaf" }],
      timestamp: 2,
    } satisfies Message);
    const second = await handlers.get("session_before_compact")![0]!(thresholdEvent, ctx);
    expect(second).toBeUndefined();
    expect(notifications).toHaveLength(1);

    await handlers.get("session_compact")![0]!({}, ctx);
    const afterCompaction = await handlers.get("session_before_compact")![0]!(thresholdEvent, ctx);
    expect(afterCompaction).toEqual({ cancel: true });
    expect(notifications).toHaveLength(2);
  });
});
