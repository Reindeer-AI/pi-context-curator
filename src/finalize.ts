import { messageText } from "./blocks.js";
import type { ContextBlock, PersistedCurationState } from "./types.js";

function roleOf(message: ContextBlock["messages"][number]): string {
  return (message as { role?: string }).role ?? "context";
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function retainedTranscript(block: ContextBlock): string {
  return block.messages
    .map((message) => `[${roleOf(message)}]\n${messageText(message)}`)
    .join("\n\n");
}

export function buildFinalizedSummary(
  state: PersistedCurationState,
  findBlock: (blockId: string) => ContextBlock | undefined,
): string {
  const sections: string[] = [];

  for (const plan of state.blocks) {
    if (plan.action === "drop") continue;
    const header = `<context-block id="${escapeAttribute(plan.id)}" action="${plan.action}" title="${escapeAttribute(plan.title)}">`;
    if (plan.action === "summarize") {
      sections.push([
        header,
        plan.summary,
        `Exact source remains available through context_recall({ block_id: "${plan.id}" }).`,
        "</context-block>",
      ].join("\n"));
      continue;
    }

    const block = findBlock(plan.id);
    sections.push([
      header,
      block ? retainedTranscript(block) : plan.summary,
      "</context-block>",
    ].join("\n"));
  }

  return [
    "# Finalized Context Curator projection",
    "This snapshot replaces earlier conversation context. It preserves retained blocks in their original order; intentionally dropped blocks are omitted.",
    "",
    ...sections,
  ].join("\n\n");
}
