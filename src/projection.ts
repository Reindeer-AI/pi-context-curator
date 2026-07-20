import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { messageApproxTokens, segmentContext, totalApproxTokens } from "./blocks.js";
import type {
  BlockAnalysis,
  ContextBlock,
  CuratedBlockPlan,
  PersistedCurationState,
  ProjectionStats,
} from "./types.js";

function summaryContent(plan: CuratedBlockPlan): string {
  return [
    `[Context Curator summary: ${plan.title}]`,
    plan.summary,
    "",
    `Original context block: ${plan.id}`,
    `Use context_recall({ block_id: "${plan.id}" }) if exact details are needed.`,
  ].join("\n");
}

export function summaryMessage(plan: CuratedBlockPlan, timestamp = Date.now()): AgentMessage {
  return {
    role: "custom",
    customType: "context-curator-summary",
    content: summaryContent(plan),
    display: true,
    details: {
      blockId: plan.id,
      originalApproxTokens: plan.approxTokens,
      title: plan.title,
    },
    timestamp,
  } as AgentMessage;
}

export function makePlans(
  blocks: ContextBlock[],
  analyses: BlockAnalysis[],
  previous?: PersistedCurationState,
  options: { reusePreviousActions?: boolean } = {},
): CuratedBlockPlan[] {
  const analysisById = new Map(analyses.map((analysis) => [analysis.id, analysis]));
  const previousById = new Map(previous?.blocks.map((block) => [block.id, block]) ?? []);

  return blocks.map((block) => {
    const analysis = analysisById.get(block.id) ?? {
      id: block.id,
      title: block.fallbackTitle,
      summary: block.fallbackTitle,
      reason: "No semantic analysis was available.",
      suggestedAction: "keep" as const,
      importance: 50,
    };
    const prior = previousById.get(block.id);
    const action = options.reusePreviousActions
      ? (prior?.action ?? analysis.suggestedAction)
      : prior?.action === "pin" || prior?.action === "summarize"
        ? prior.action
        : analysis.suggestedAction;
    return {
      ...analysis,
      action,
      approxTokens: block.approxTokens,
      messageCount: block.messages.length,
    };
  });
}

export function inventoryBlocks(
  messages: AgentMessage[],
  state: PersistedCurationState | undefined,
): ContextBlock[] {
  const blocks = segmentContext(messages);
  if (!state?.enabled) return blocks;

  const planById = new Map(state.blocks.map((block) => [block.id, block]));
  return blocks.flatMap((block) => {
    const plan = planById.get(block.id);
    if (plan?.action === "drop") return [];
    if (plan?.action === "summarize") {
      const message = summaryMessage(plan, block.startTimestamp);
      return [{
        ...block,
        messages: [message],
        approxTokens: messageApproxTokens(message),
        fallbackTitle: plan.title,
      }];
    }
    return [block];
  });
}

export function mergeHiddenPlans(
  rawBlocks: ContextBlock[],
  visiblePlans: CuratedBlockPlan[],
  previous: PersistedCurationState | undefined,
): CuratedBlockPlan[] {
  const visibleById = new Map(visiblePlans.map((plan) => [plan.id, plan]));
  const previousById = new Map(previous?.blocks.map((plan) => [plan.id, plan]) ?? []);

  return rawBlocks.flatMap((block) => {
    const visible = visibleById.get(block.id);
    if (visible) return [visible];
    const prior = previousById.get(block.id);
    return previous?.enabled && prior?.action === "drop" ? [prior] : [];
  });
}

export function projectMessages(
  messages: AgentMessage[],
  state: PersistedCurationState | undefined,
): { messages: AgentMessage[]; stats: ProjectionStats } {
  const blocks = segmentContext(messages);
  const planById = new Map(state?.blocks.map((block) => [block.id, block]) ?? []);
  const projected: AgentMessage[] = [];
  let keptBlocks = 0;
  let summarizedBlocks = 0;
  let droppedBlocks = 0;
  let pinnedBlocks = 0;

  for (const block of blocks) {
    const plan = planById.get(block.id);
    const action = state?.enabled ? (plan?.action ?? "keep") : "keep";
    if (action === "drop") {
      droppedBlocks += 1;
      continue;
    }
    if (action === "summarize" && plan) {
      summarizedBlocks += 1;
      projected.push(summaryMessage(plan, block.startTimestamp));
      continue;
    }
    if (action === "pin") pinnedBlocks += 1;
    else keptBlocks += 1;
    projected.push(...block.messages);
  }

  return {
    messages: projected,
    stats: {
      beforeApproxTokens: totalApproxTokens(blocks),
      afterApproxTokens: projected.reduce((sum, message) => sum + messageApproxTokens(message), 0),
      keptBlocks,
      summarizedBlocks,
      droppedBlocks,
      pinnedBlocks,
    },
  };
}

export function estimatePlan(blocks: ContextBlock[], plans: CuratedBlockPlan[]): ProjectionStats {
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  let afterApproxTokens = 0;
  let keptBlocks = 0;
  let summarizedBlocks = 0;
  let droppedBlocks = 0;
  let pinnedBlocks = 0;

  for (const block of blocks) {
    const plan = planById.get(block.id);
    if (!plan) {
      keptBlocks += 1;
      afterApproxTokens += block.approxTokens;
      continue;
    }
    switch (plan.action) {
      case "drop":
        droppedBlocks += 1;
        break;
      case "summarize":
        summarizedBlocks += 1;
        afterApproxTokens += messageApproxTokens(summaryMessage(plan, block.startTimestamp));
        break;
      case "pin":
        pinnedBlocks += 1;
        afterApproxTokens += block.approxTokens;
        break;
      default:
        keptBlocks += 1;
        afterApproxTokens += block.approxTokens;
        break;
    }
  }

  return {
    beforeApproxTokens: totalApproxTokens(blocks),
    afterApproxTokens,
    keptBlocks,
    summarizedBlocks,
    droppedBlocks,
    pinnedBlocks,
  };
}
