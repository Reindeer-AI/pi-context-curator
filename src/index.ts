import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  buildSessionContext,
  sessionEntryToContextMessages,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { analyzeBlocks, buildFallbackAnalysis } from "./analyzer.js";
import { segmentContext } from "./blocks.js";
import { buildFinalizedSummary } from "./finalize.js";
import {
  estimatePlan,
  inventoryBlocks,
  makePlans,
  mergeHiddenPlans,
  projectMessages,
} from "./projection.js";
import { recallPage, serializeRecallBlock } from "./recall.js";
import {
  CURATOR_STATE_ENTRY,
  contextChangePercent,
  disabledState,
  isCurationState,
  reductionPercent,
  restoreCurationState,
} from "./state.js";
import type {
  BlockAnalysis,
  PersistedCurationState,
} from "./types.js";
import { openCurationUi } from "./ui.js";

function modelLabel(ctx: Pick<ExtensionContext, "model">): string | undefined {
  return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
}

function stateStatus(state: PersistedCurationState | undefined): string {
  if (!state?.enabled) return "Context Curator is inactive.";
  const pin = state.blocks.filter((block) => block.action === "pin").length;
  const keep = state.blocks.filter((block) => block.action === "keep").length;
  const summarize = state.blocks.filter((block) => block.action === "summarize").length;
  const drop = state.blocks.filter((block) => block.action === "drop").length;
  const change = contextChangePercent(state.beforeApproxTokens, state.afterApproxTokens);
  const changeLabel = change <= 0 ? `${change}%` : `+${change}%`;
  return [
    `Context Curator active: ~${state.beforeApproxTokens.toLocaleString()} → ~${state.afterApproxTokens.toLocaleString()} tokens (${changeLabel}).`,
    `${pin} pinned · ${keep} kept · ${summarize} summarized · ${drop} dropped.`,
    state.model ? `Inventory model: ${state.model}.` : "Inventory used deterministic fallback.",
  ].join("\n");
}

function branchMessages(ctx: Pick<ExtensionContext, "sessionManager">): AgentMessage[] {
  return ctx.sessionManager
    .getBranch()
    .flatMap((entry) => sessionEntryToContextMessages(entry));
}

function activeMessages(ctx: Pick<ExtensionContext, "sessionManager">): AgentMessage[] {
  return ctx.sessionManager
    .buildContextEntries()
    .flatMap((entry) => sessionEntryToContextMessages(entry));
}

function stateEntryId(
  ctx: Pick<ExtensionContext, "sessionManager">,
  state: PersistedCurationState,
): string | undefined {
  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    if (entry.type !== "custom" || entry.customType !== CURATOR_STATE_ENTRY) continue;
    if (!isCurationState(entry.data)) continue;
    if (entry.data.createdAt === state.createdAt) return entry.id;
  }
  return undefined;
}

export function findRecallBlock(
  ctx: Pick<ExtensionContext, "sessionManager">,
  blockId: string,
) {
  const contexts: AgentMessage[][] = [activeMessages(ctx)];
  const allEntries = ctx.sessionManager.getEntries();
  const sourceLeaves = new Set<string>();

  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    if (entry.type !== "custom" || entry.customType !== CURATOR_STATE_ENTRY) continue;
    if (!isCurationState(entry.data) || !entry.data.sourceLeafId) continue;
    if (sourceLeaves.has(entry.data.sourceLeafId)) continue;
    sourceLeaves.add(entry.data.sourceLeafId);
    contexts.push(buildSessionContext(allEntries, entry.data.sourceLeafId).messages);
  }
  contexts.push(branchMessages(ctx));

  for (const messages of contexts) {
    const block = segmentContext(messages).find((candidate) => candidate.id === blockId);
    if (block) return block;
  }
  return undefined;
}

export default function contextCuratorExtension(pi: ExtensionAPI) {
  let activeState: PersistedCurationState | undefined;
  let curationInProgress = false;
  let postponedThresholdLeafId: string | undefined;
  let finalizingStateCreatedAt: string | undefined;

  const updateStatus = (ctx: Pick<ExtensionContext, "ui">) => {
    if (!activeState?.enabled) {
      ctx.ui.setStatus("context-curator", undefined);
      return;
    }
    const reduction = reductionPercent(activeState);
    const label = reduction > 0 ? `curated -${reduction}%` : "curated";
    ctx.ui.setStatus("context-curator", ctx.ui.theme.fg("accent", label));
  };

  const restore = (ctx: Pick<ExtensionContext, "sessionManager" | "ui">) => {
    activeState = restoreCurationState(ctx.sessionManager.getBranch());
    postponedThresholdLeafId = undefined;
    updateStatus(ctx);
  };

  const persist = (state: PersistedCurationState, ctx: Pick<ExtensionContext, "ui">) => {
    activeState = state;
    postponedThresholdLeafId = undefined;
    pi.appendEntry(CURATOR_STATE_ENTRY, state);
    updateStatus(ctx);
  };

  const analysesFromState = (
    state: PersistedCurationState | undefined,
  ): BlockAnalysis[] | undefined => {
    if (!state?.enabled) return undefined;
    return state.blocks.map((block) => ({
      id: block.id,
      title: block.title,
      summary: block.summary,
      reason: block.reason,
      suggestedAction: block.suggestedAction,
      importance: block.importance,
    }));
  };

  const runCuration = async (
    ctx: ExtensionContext,
    options: { reuseInventory?: boolean; signal?: AbortSignal } = {},
  ): Promise<boolean> => {
    if (curationInProgress) {
      ctx.ui.notify("Context curation is already running.", "warning");
      return false;
    }
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Context curation requires interactive TUI mode.", "warning");
      return false;
    }

    curationInProgress = true;
    try {
      const sourceMessages = activeMessages(ctx);
      const rawBlocks = segmentContext(sourceMessages);
      const blocks = inventoryBlocks(sourceMessages, activeState);
      if (blocks.length === 0) {
        ctx.ui.notify("There is no active conversation context to curate.", "warning");
        return false;
      }

      let analyses = options.reuseInventory ? analysesFromState(activeState) : undefined;
      let inventoryModel = activeState?.model;
      if (!analyses) {
        ctx.ui.notify(
          `Building a semantic inventory of ${blocks.length} context block${blocks.length === 1 ? "" : "s"}...`,
          "info",
        );
        const result = await analyzeBlocks(blocks, ctx, options.signal);
        analyses = result.analyses;
        inventoryModel = result.usedFallback ? undefined : result.model;
        if (result.warning) {
          ctx.ui.notify(`Inventory fallback: ${result.warning}`, "warning");
        }
      }

      const analysisById = new Map(analyses.map((analysis) => [analysis.id, analysis]));
      const fallbackById = new Map(
        buildFallbackAnalysis(blocks).map((analysis) => [analysis.id, analysis]),
      );
      const completeAnalyses = blocks.map(
        (block) => analysisById.get(block.id) ?? fallbackById.get(block.id)!,
      );
      const initialPlans = makePlans(blocks, completeAnalyses, activeState, {
        reusePreviousActions: options.reuseInventory === true,
      });
      const selectedPlans = await openCurationUi(ctx, blocks, initialPlans);
      if (!selectedPlans) {
        ctx.ui.notify("Context curation cancelled; normal context remains active.", "info");
        return false;
      }

      const finalPlans = mergeHiddenPlans(rawBlocks, selectedPlans, activeState);
      const stats = estimatePlan(rawBlocks, finalPlans);
      const leafId = ctx.sessionManager.getLeafId() ?? undefined;
      const label = inventoryModel ?? modelLabel(ctx);
      const state: PersistedCurationState = {
        version: 1,
        enabled: true,
        createdAt: new Date().toISOString(),
        ...(leafId ? { sourceLeafId: leafId } : {}),
        ...(label ? { model: label } : {}),
        beforeApproxTokens: stats.beforeApproxTokens,
        afterApproxTokens: stats.afterApproxTokens,
        blocks: finalPlans,
      };
      persist(state, ctx);
      ctx.ui.notify(stateStatus(state), "info");
      return true;
    } finally {
      curationInProgress = false;
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    restore(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restore(ctx);
  });

  pi.on("context", async (event) => {
    if (!activeState?.enabled) return;
    return { messages: projectMessages(event.messages, activeState).messages };
  });

  pi.on("session_before_compact", async (event, ctx) => {
    if (activeState?.enabled) {
      if (event.reason === "threshold") {
        const source = activeMessages(ctx);
        const projected = projectMessages(source, activeState);
        const contextWindow = ctx.model?.contextWindow ?? 0;
        if (contextWindow > 0 && projected.stats.afterApproxTokens <= contextWindow * 0.65) {
          ctx.ui.notify(
            "Skipped native compaction: the curated projection is already below the safe context target.",
            "info",
          );
          return { cancel: true };
        }
      }

      const firstKeptEntryId = stateEntryId(ctx, activeState);
      if (!firstKeptEntryId) {
        ctx.ui.notify("Could not locate the active curation checkpoint; using native compaction.", "warning");
        return;
      }
      const summary = buildFinalizedSummary(activeState, (blockId) =>
        findRecallBlock(ctx, blockId),
      );
      finalizingStateCreatedAt = activeState.createdAt;
      return {
        compaction: {
          summary,
          firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
          details: {
            contextCurator: {
              version: 1,
              stateCreatedAt: activeState.createdAt,
              blocks: activeState.blocks,
            },
          },
        },
      };
    }

    if (event.reason === "overflow" || ctx.mode !== "tui") return;
    if (event.reason === "threshold") {
      const leafId = ctx.sessionManager.getLeafId() ?? "root";
      if (postponedThresholdLeafId !== leafId) {
        postponedThresholdLeafId = leafId;
        ctx.ui.notify(
          "Context is near its limit. Native compaction was postponed once; run /context-curate to review it before the next turn.",
          "warning",
        );
        return { cancel: true };
      }
      return;
    }

    const applied = await runCuration(ctx, { signal: event.signal });
    if (applied) return { cancel: true };
    return;
  });

  pi.on("session_compact", async (_event, ctx) => {
    if (!activeState?.enabled || finalizingStateCreatedAt !== activeState.createdAt) return;
    finalizingStateCreatedAt = undefined;
    persist(disabledState(activeState), ctx);
    ctx.ui.notify("Curated projection finalized into Pi's native context.", "info");
  });

  pi.registerCommand("context-curate", {
    description: "Inspect and curate active context (usage: /context-curate [edit|status|reset|help])",
    getArgumentCompletions: (prefix) => {
      const options = ["edit", "status", "reset", "help"];
      const matches = options.filter((option) => option.startsWith(prefix.trim().toLowerCase()));
      return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (!action) {
        await runCuration(ctx);
        return;
      }
      if (action === "edit") {
        await runCuration(ctx, { reuseInventory: true });
        return;
      }
      if (action === "status") {
        ctx.ui.notify(stateStatus(activeState), "info");
        return;
      }
      if (action === "reset") {
        const state = disabledState(activeState);
        persist(state, ctx);
        ctx.ui.notify("Context curation reset; the full active session context is visible again.", "info");
        return;
      }
      if (action === "help") {
        ctx.ui.notify(
          [
            "/context-curate — rebuild the semantic inventory and open the curator",
            "/context-curate edit — edit the existing inventory without another model call",
            "/context-curate status — show the active projection",
            "/context-curate reset — restore the full context projection",
            "",
            "With no active plan, /compact opens the curator. With a plan active, /compact finalizes it into native context.",
          ].join("\n"),
          "info",
        );
        return;
      }
      ctx.ui.notify("Usage: /context-curate [edit|status|reset|help]", "warning");
    },
  });

  pi.registerTool({
    name: "context_recall",
    label: "Context Recall",
    description:
      "Recover exact original content for a block summarized by Context Curator. Use the block_id shown in a curator summary. Results are paginated by character offset.",
    promptSnippet: "Recall exact original content from a Context Curator summary block",
    promptGuidelines: [
      "Use context_recall only when a Context Curator summary says exact details from a block are needed.",
    ],
    parameters: Type.Object({
      block_id: Type.String({ description: "Context block id from a Context Curator summary" }),
      offset: Type.Optional(Type.Integer({ minimum: 0, description: "Character offset, default 0" })),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 30_000, description: "Maximum characters, default 20000" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const block = findRecallBlock(ctx, params.block_id);
      if (!block) {
        throw new Error(`Unknown context block: ${params.block_id}`);
      }
      const serialized = serializeRecallBlock(block);
      const page = recallPage(serialized, params.offset ?? 0, params.limit ?? 20_000);
      const continuation = page.nextOffset === undefined
        ? "End of block."
        : `More content is available; call context_recall again with offset=${page.nextOffset}.`;
      return {
        content: [
          {
            type: "text",
            text: [
              `Context block ${block.id} (${page.offset}-${page.offset + page.text.length} of ${page.totalChars} chars)`,
              "",
              page.text,
              "",
              continuation,
            ].join("\n"),
          },
        ],
        details: {
          blockId: block.id,
          offset: page.offset,
          returnedChars: page.text.length,
          totalChars: page.totalChars,
          nextOffset: page.nextOffset,
        },
      };
    },
  });
}
