import { describe, expect, it } from "vitest";
import { openCurationUi } from "../src/ui.js";
import type { ContextBlock, CuratedBlockPlan } from "../src/types.js";

function fixtures(count: number): { blocks: ContextBlock[]; plans: CuratedBlockPlan[] } {
  const blocks = Array.from({ length: count }, (_, index): ContextBlock => ({
    id: `block-${index}`,
    index,
    messages: [],
    approxTokens: 100 + index,
    fallbackTitle: `Block ${index}`,
    startTimestamp: index,
  }));
  const plans = blocks.map((block): CuratedBlockPlan => ({
    id: block.id,
    title: block.fallbackTitle,
    summary: `Summary ${block.index}`,
    reason: `Reason ${block.index}`,
    suggestedAction: "pin",
    action: "pin",
    importance: block.index,
    approxTokens: block.approxTokens,
    messageCount: 1,
  }));
  return { blocks, plans };
}

async function renderUi(inputs: string[], vimNavigation = false) {
  const { blocks, plans } = fixtures(10);
  let lines: string[] = [];
  const theme = {
    fg: (_name: string, text: string) => text,
    bg: (_name: string, text: string) => text,
    bold: (text: string) => text,
  };
  const tui = { requestRender() {} };
  const keybindings = {
    matches(data: string, id: string) {
      if (data === "enter") return id === "tui.select.confirm";
      return vimNavigation && data === "k" && id === "tui.select.up";
    },
  };
  const ui = {
    theme,
    async custom(factory: Function) {
      let result: CuratedBlockPlan[] | null = null;
      const component = factory(tui, theme, keybindings, (value: CuratedBlockPlan[] | null) => {
        result = value;
      });
      for (const input of inputs) component.handleInput(input);
      lines = component.render(90);
      return result;
    },
  };

  await openCurationUi({ mode: "tui", ui } as never, blocks, plans);
  return lines;
}

async function withTerminalRows<T>(rows: number, fn: () => Promise<T>): Promise<T> {
  const ownDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "rows");
  Object.defineProperty(process.stdout, "rows", { configurable: true, value: rows });
  try {
    return await fn();
  } finally {
    if (ownDescriptor) Object.defineProperty(process.stdout, "rows", ownDescriptor);
    else delete (process.stdout as { rows?: number }).rows;
  }
}

describe("curation UI", () => {
  it("opens with the selected latest block visible", async () => {
    const lines = await withTerminalRows(17, () => renderUi([]));
    expect(lines.some((line) => line.startsWith(">") && line.includes("Block 9"))).toBe(true);
    expect(lines.some((line) => line.startsWith(" ") && line.includes("Block 0"))).toBe(false);
  });

  it("reserves literal action keys even when they collide with navigation bindings", async () => {
    const lines = await withTerminalRows(17, () => renderUi(["k"], true));
    expect(lines.some((line) => line.startsWith(">") && line.includes("KEEP") && line.includes("Block 9"))).toBe(true);
  });
});
