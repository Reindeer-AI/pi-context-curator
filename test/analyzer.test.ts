import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { buildFallbackAnalysis, parseInventoryResponse } from "../src/analyzer.js";
import { segmentContext } from "../src/blocks.js";

const blocks = segmentContext([
  { role: "user", content: "Old investigation", timestamp: 1 } as AgentMessage,
  { role: "user", content: "Current implementation", timestamp: 2 } as AgentMessage,
]);

describe("inventory parsing", () => {
  it("accepts fenced JSON, ignores invented ids, and pins the latest block", () => {
    const response = `\`\`\`json
${JSON.stringify({
  blocks: [
    {
      id: blocks[0]!.id,
      title: "Auth investigation",
      summary: "The old token path failed.",
      reason: "Superseded",
      suggestedAction: "drop",
      importance: 20,
    },
    {
      id: blocks[1]!.id,
      title: "Implementation",
      summary: "Build the extension.",
      reason: "Active",
      suggestedAction: "keep",
      importance: 90,
    },
    { id: "invented", title: "Bad", summary: "Bad", reason: "Bad", suggestedAction: "drop", importance: 0 },
  ],
})}
\`\`\``;

    const parsed = parseInventoryResponse(response, blocks);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.suggestedAction).toBe("drop");
    expect(parsed[1]?.suggestedAction).toBe("pin");
    expect(parsed[1]?.importance).toBe(100);
  });

  it("uses conservative deterministic actions", () => {
    const fallback = buildFallbackAnalysis(blocks);
    expect(fallback[0]?.suggestedAction).toBe("keep");
    expect(fallback[1]?.suggestedAction).toBe("pin");
  });
});
