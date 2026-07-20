import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { visibleWidth } from "@earendil-works/pi-tui";
import { openCurationUi } from "../src/ui.js";
import type { ContextBlock, CuratedBlockPlan, CurationAction } from "../src/types.js";

const outputDir = join(import.meta.dirname, "..", "docs", "screenshots");

const colors = {
  accent: "#d7a8ff",
  text: "#e8e2eb",
  muted: "#a69eaa",
  dim: "#756e79",
  success: "#79d991",
  warning: "#f2c866",
  error: "#f07b84",
  borderMuted: "#514a57",
  selectedBg: "#403747",
} as const;

function rgb(hex: string): string {
  const value = hex.replace("#", "");
  return `${Number.parseInt(value.slice(0, 2), 16)};${Number.parseInt(value.slice(2, 4), 16)};${Number.parseInt(value.slice(4, 6), 16)}`;
}

const theme = {
  fg(name: keyof typeof colors, text: string) {
    return `\u001b[38;2;${rgb(colors[name])}m${text}\u001b[39m`;
  },
  bg(name: keyof typeof colors, text: string) {
    return `\u001b[48;2;${rgb(colors[name])}m${text}\u001b[49m`;
  },
  bold(text: string) {
    return `\u001b[1m${text}\u001b[22m`;
  },
};

const keybindings = {
  matches(data: string, id: string) {
    return (
      (data === "up" && id === "tui.select.up") ||
      (data === "down" && id === "tui.select.down") ||
      (data === "enter" && id === "tui.select.confirm") ||
      (data === "escape" && id === "tui.select.cancel")
    );
  },
};

const rows = [
  {
    title: "Original product requirements and API constraints",
    summary: "Preserve the user-approved behavior, command names, reversibility requirement, and compatibility constraints.",
    reason: "These requirements define the current task and must survive later curation passes.",
    action: "pin" as const,
    tokens: 3_840,
    importance: 96,
    messages: 5,
  },
  {
    title: "Superseded authentication investigation",
    summary: "An abandoned approach attempted to pass a support token through the browser profile.",
    reason: "The local-JWKS approach replaced this investigation and none of its implementation remains active.",
    action: "drop" as const,
    tokens: 9_420,
    importance: 18,
    messages: 12,
  },
  {
    title: "Generated API client output and schema inspection",
    summary: "The generated client exposes listCases, getCase, and updateCase. Regenerate it after OpenAPI changes with `bun run --filter @reindeer/console generate:api`.",
    reason: "The conclusion and regeneration command matter; the large generated source dump does not.",
    action: "summarize" as const,
    tokens: 18_760,
    importance: 64,
    messages: 9,
  },
  {
    title: "Context Curator implementation",
    summary: "Implemented semantic inventory, persistent decisions, request-time projection, recall, and automatic compaction interception.",
    reason: "Current implementation details remain useful while testing and refining the extension.",
    action: "keep" as const,
    tokens: 6_280,
    importance: 82,
    messages: 16,
  },
  {
    title: "Current install and packaging verification",
    summary: "The package installs from Reindeer-AI/pi-context-curator and loads through Pi. Continue with screenshots and README polish.",
    reason: "This is the active task and most recent context, so it is pinned by default.",
    action: "pin" as const,
    tokens: 2_940,
    importance: 100,
    messages: 6,
  },
];

const blocks: ContextBlock[] = rows.map((row, index) => ({
  id: `user:${1_700_000_000_000 + index}:sample${index}`,
  index,
  messages: [
    {
      role: "user",
      content: row.title,
      timestamp: 1_700_000_000_000 + index,
    } as AgentMessage,
  ],
  approxTokens: row.tokens,
  fallbackTitle: row.title,
  startTimestamp: 1_700_000_000_000 + index,
}));

const plans: CuratedBlockPlan[] = rows.map((row, index) => ({
  id: blocks[index]!.id,
  title: row.title,
  summary: row.summary,
  reason: row.reason,
  suggestedAction: row.action,
  action: row.action,
  importance: row.importance,
  approxTokens: row.tokens,
  messageCount: row.messages,
}));

async function capture(inputs: string[]): Promise<string[]> {
  let captured: string[] = [];
  const tui = {
    terminal: { rows: 28 },
    requestRender() {},
  };
  const ui = {
    theme,
    async custom(factory: Function) {
      const component = factory(tui, theme, keybindings, () => {});
      for (const input of inputs) component.handleInput(input);
      captured = component.render(112);
      return null;
    },
  };

  await openCurationUi({ mode: "tui", ui } as never, blocks, plans);
  return captured;
}

type AnsiState = { foreground: string; background?: string; bold: boolean };
type Segment = { text: string; state: AnsiState };

function parseAnsi(line: string): Segment[] {
  const state: AnsiState = { foreground: colors.text, bold: false };
  const segments: Segment[] = [];
  const regex = /\u001b\[([0-9;]*)m/g;
  let offset = 0;
  let match: RegExpExecArray | null;

  const append = (text: string) => {
    if (text) segments.push({ text, state: { ...state } });
  };

  while ((match = regex.exec(line))) {
    append(line.slice(offset, match.index));
    const codes = (match[1] || "0").split(";").map(Number);
    for (let index = 0; index < codes.length; index += 1) {
      const code = codes[index];
      if (code === 0) {
        state.foreground = colors.text;
        delete state.background;
        state.bold = false;
      } else if (code === 1) state.bold = true;
      else if (code === 22) state.bold = false;
      else if (code === 39) state.foreground = colors.text;
      else if (code === 49) delete state.background;
      else if ((code === 38 || code === 48) && codes[index + 1] === 2) {
        const color = `rgb(${codes[index + 2]},${codes[index + 3]},${codes[index + 4]})`;
        if (code === 38) state.foreground = color;
        else state.background = color;
        index += 4;
      }
    }
    offset = regex.lastIndex;
  }
  append(line.slice(offset));
  return segments;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function terminalSvg(lines: string[], title: string): string {
  const cellWidth = 9.35;
  const lineHeight = 22;
  const paddingX = 28;
  const terminalTop = 58;
  const width = 1_110;
  const height = terminalTop + paddingX + lines.length * lineHeight;
  const body: string[] = [];

  lines.forEach((line, row) => {
    let column = 0;
    const y = terminalTop + 25 + row * lineHeight;
    for (const segment of parseAnsi(line)) {
      const columns = visibleWidth(segment.text);
      const x = paddingX + column * cellWidth;
      if (segment.state.background) {
        body.push(
          `<rect x="${x.toFixed(2)}" y="${(y - 16).toFixed(2)}" width="${(columns * cellWidth).toFixed(2)}" height="21" fill="${segment.state.background}" rx="2"/>`,
        );
      }
      body.push(
        `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" fill="${segment.state.foreground}" font-weight="${segment.state.bold ? 700 : 400}" xml:space="preserve">${escapeXml(segment.text)}</text>`,
      );
      column += columns;
    }
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000000" flood-opacity="0.42"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="#161318"/>
  <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="15" fill="#211d24" stroke="#4b434f" filter="url(#shadow)"/>
  <rect x="12" y="12" width="${width - 24}" height="46" rx="15" fill="#2b252e"/>
  <rect x="12" y="43" width="${width - 24}" height="15" fill="#2b252e"/>
  <circle cx="36" cy="35" r="6" fill="#ff6b68"/>
  <circle cx="56" cy="35" r="6" fill="#f6c85f"/>
  <circle cx="76" cy="35" r="6" fill="#68d391"/>
  <text x="${width / 2}" y="40" text-anchor="middle" fill="#a69eaa" font-family="Menlo, SFMono-Regular, Consolas, monospace" font-size="13">${escapeXml(title)}</text>
  <g font-family="Menlo, SFMono-Regular, Consolas, monospace" font-size="14">${body.join("\n")}</g>
</svg>`;
}

async function writeScreenshot(name: string, lines: string[], title: string) {
  const svgPath = join(outputDir, `${name}.svg`);
  const pngPath = join(outputDir, `${name}.png`);
  await writeFile(svgPath, terminalSvg(lines, title));
  execFileSync("sips", ["-s", "format", "png", svgPath, "--out", pngPath], { stdio: "ignore" });
  console.log(`${svgPath}\n${pngPath}`);
}

await mkdir(outputDir, { recursive: true });
await writeScreenshot("curator-overview", await capture([]), "pi · /context-curate");
await writeScreenshot(
  "curator-summary-detail",
  await capture(["up", "up"]),
  "pi · semantic inventory detail",
);
