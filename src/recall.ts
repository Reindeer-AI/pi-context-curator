import type { ContextBlock } from "./types.js";

export interface RecallPage {
  text: string;
  offset: number;
  limit: number;
  totalChars: number;
  nextOffset?: number;
}

export function serializeRecallBlock(block: ContextBlock): string {
  return block.messages
    .map((message, index) => {
      const role = (message as { role?: string }).role ?? "unknown";
      let serialized: string;
      try {
        serialized = JSON.stringify(message, null, 2);
      } catch {
        serialized = String(message);
      }
      return `[Message ${index + 1}: ${role}]\n${serialized}`;
    })
    .join("\n\n");
}

export function recallPage(text: string, offset = 0, limit = 20_000): RecallPage {
  const safeOffset = Math.max(0, Math.min(Math.floor(offset), text.length));
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 30_000));
  const end = Math.min(text.length, safeOffset + safeLimit);
  const page: RecallPage = {
    text: text.slice(safeOffset, end),
    offset: safeOffset,
    limit: safeLimit,
    totalChars: text.length,
  };
  if (end < text.length) page.nextOffset = end;
  return page;
}
