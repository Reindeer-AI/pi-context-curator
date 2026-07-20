import { createHash } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ContextBlock } from "./types.js";

interface ContentPart {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: unknown;
}

interface MessageLike {
  role?: string;
  content?: unknown;
  summary?: string;
  command?: string;
  output?: string;
  timestamp?: number;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function contentParts(content: unknown): ContentPart[] {
  return Array.isArray(content) ? (content as ContentPart[]) : [];
}

export function messageText(message: AgentMessage): string {
  const value = message as MessageLike;
  if (typeof value.content === "string") return value.content;

  const pieces: string[] = [];
  for (const part of contentParts(value.content)) {
    if (part.type === "text" && typeof part.text === "string") {
      pieces.push(part.text);
    } else if (part.type === "thinking" && typeof part.thinking === "string") {
      pieces.push(part.thinking);
    } else if (part.type === "toolCall") {
      pieces.push(`${part.name ?? "tool"}(${safeStringify(part.arguments ?? {})})`);
    }
  }

  if (typeof value.summary === "string") pieces.push(value.summary);
  if (typeof value.command === "string") pieces.push(`$ ${value.command}`);
  if (typeof value.output === "string") pieces.push(value.output);
  return pieces.join("\n");
}

export function messageApproxTokens(message: AgentMessage): number {
  return Math.max(1, Math.ceil(messageText(message).length / 4));
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value) ?? "";
}

function messageTimestamp(message: AgentMessage): number {
  const timestamp = (message as MessageLike).timestamp;
  return typeof timestamp === "number" ? timestamp : 0;
}

function blockId(messages: AgentMessage[], occurrence: number): string {
  const first = messages[0] as MessageLike | undefined;
  const firstUser = messages.find((message) => (message as MessageLike).role === "user");
  const anchor = firstUser ?? messages[0];
  const anchorValue = anchor as MessageLike | undefined;
  const role = anchorValue?.role ?? first?.role ?? "context";
  const timestamp = anchor ? messageTimestamp(anchor) : 0;
  const text = anchor ? compactWhitespace(messageText(anchor)).slice(0, 4_000) : "empty";
  const suffix = occurrence > 0 ? `:${occurrence}` : "";
  return `${role}:${timestamp}:${shortHash(text || role)}${suffix}`;
}

function fallbackTitle(messages: AgentMessage[]): string {
  const firstUser = messages.find((message) => (message as MessageLike).role === "user");
  const candidate = firstUser ?? messages.find((message) => compactWhitespace(messageText(message))) ?? messages[0];
  if (!candidate) return "Empty context block";

  const role = (candidate as MessageLike).role ?? "context";
  const firstLine = compactWhitespace(messageText(candidate)).slice(0, 84);
  if (firstLine) return firstLine;
  return `${role} context`;
}

export function segmentContext(messages: AgentMessage[]): ContextBlock[] {
  if (messages.length === 0) return [];

  const groups: AgentMessage[][] = [];
  let current: AgentMessage[] = [];

  for (const message of messages) {
    const isUser = (message as MessageLike).role === "user";
    if (isUser && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length > 0) groups.push(current);

  const seenIds = new Map<string, number>();
  return groups.map((group, index) => {
    const base = blockId(group, 0);
    const occurrence = seenIds.get(base) ?? 0;
    seenIds.set(base, occurrence + 1);
    const id = occurrence === 0 ? base : blockId(group, occurrence);
    return {
      id,
      index,
      messages: group,
      approxTokens: group.reduce((sum, message) => sum + messageApproxTokens(message), 0),
      fallbackTitle: fallbackTitle(group),
      startTimestamp: messageTimestamp(group[0]!),
    };
  });
}

export function totalApproxTokens(blocks: ContextBlock[]): number {
  return blocks.reduce((sum, block) => sum + block.approxTokens, 0);
}
