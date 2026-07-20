import type { CuratedBlockPlan, PersistedCurationState } from "./types.js";

export const CURATOR_STATE_ENTRY = "context-curator-state";

interface CustomEntryLike {
  type?: string;
  customType?: string;
  data?: unknown;
}

function isPlan(value: unknown): value is CuratedBlockPlan {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.summary === "string" &&
    typeof item.reason === "string" &&
    ["keep", "summarize", "drop", "pin"].includes(String(item.action)) &&
    ["keep", "summarize", "drop", "pin"].includes(String(item.suggestedAction)) &&
    typeof item.approxTokens === "number" &&
    typeof item.messageCount === "number"
  );
}

export function isCurationState(value: unknown): value is PersistedCurationState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    state.version === 1 &&
    typeof state.enabled === "boolean" &&
    typeof state.createdAt === "string" &&
    typeof state.beforeApproxTokens === "number" &&
    typeof state.afterApproxTokens === "number" &&
    Array.isArray(state.blocks) &&
    state.blocks.every(isPlan)
  );
}

export function restoreCurationState(entries: readonly unknown[]): PersistedCurationState | undefined {
  let latest: PersistedCurationState | undefined;
  for (const raw of entries) {
    const entry = raw as CustomEntryLike;
    if (entry.type !== "custom" || entry.customType !== CURATOR_STATE_ENTRY) continue;
    if (isCurationState(entry.data)) latest = entry.data;
  }
  return latest;
}

export function disabledState(previous?: PersistedCurationState): PersistedCurationState {
  return {
    version: 1,
    enabled: false,
    createdAt: new Date().toISOString(),
    beforeApproxTokens: previous?.beforeApproxTokens ?? 0,
    afterApproxTokens: previous?.beforeApproxTokens ?? 0,
    blocks: [],
  };
}

export function reductionPercent(state: PersistedCurationState): number {
  if (state.beforeApproxTokens <= 0) return 0;
  return Math.max(
    0,
    Math.round(
      ((state.beforeApproxTokens - state.afterApproxTokens) / state.beforeApproxTokens) * 100,
    ),
  );
}
