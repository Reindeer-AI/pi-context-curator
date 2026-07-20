import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ContextBlock, CuratedBlockPlan, CurationAction } from "./types.js";
import { estimatePlan } from "./projection.js";
import { contextChangePercent } from "./state.js";

const ACTION_ORDER: CurationAction[] = ["keep", "summarize", "drop", "pin"];

function formatTokens(value: number): string {
  if (value >= 100_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString("en-US");
}

function nextAction(action: CurationAction): CurationAction {
  const index = ACTION_ORDER.indexOf(action);
  return ACTION_ORDER[(index + 1) % ACTION_ORDER.length]!;
}

function clonePlans(plans: CuratedBlockPlan[]): CuratedBlockPlan[] {
  return plans.map((plan) => ({ ...plan }));
}

export async function openCurationUi(
  ctx: Pick<ExtensionContext, "ui" | "mode">,
  blocks: ContextBlock[],
  plans: CuratedBlockPlan[],
): Promise<CuratedBlockPlan[] | null> {
  if (ctx.mode !== "tui") return null;

  const initial = clonePlans(plans);
  return ctx.ui.custom<CuratedBlockPlan[] | null>(
    (tui, theme, keybindings, done) => {
      const working = clonePlans(plans);
      let selected = Math.max(0, working.length - 1);
      let scroll = 0;

      const setAction = (action: CurationAction) => {
        const item = working[selected];
        if (!item) return;
        item.action = action;
      };

      const terminalRows = () => process.stdout.rows ?? Number.parseInt(process.env.LINES ?? "40", 10);

      const visibleRows = () => Math.max(4, Math.min(working.length, terminalRows() - 13));

      const keepSelectedVisible = () => {
        const visible = visibleRows();
        if (selected < scroll) scroll = selected;
        if (selected >= scroll + visible) scroll = selected - visible + 1;
        scroll = Math.max(0, Math.min(scroll, Math.max(0, working.length - visible)));
      };

      keepSelectedVisible();

      const renderAction = (action: CurationAction): string => {
        const label = action.toUpperCase().padEnd(9);
        switch (action) {
          case "pin":
            return theme.fg("accent", label);
          case "drop":
            return theme.fg("error", label);
          case "summarize":
            return theme.fg("warning", label);
          default:
            return theme.fg("success", label);
        }
      };

      return {
        render(width: number): string[] {
          const safeWidth = Math.max(20, width);
          const stats = estimatePlan(blocks, working);
          const change = contextChangePercent(stats.beforeApproxTokens, stats.afterApproxTokens);
          const changeLabel = change <= 0 ? `${change}%` : `+${change}%`;
          const lines: string[] = [];
          lines.push(truncateToWidth(theme.fg("accent", theme.bold("Context Curator")), safeWidth));
          lines.push(
            truncateToWidth(
              `${theme.fg("muted", "Projected context:")} ~${formatTokens(stats.beforeApproxTokens)} → ~${formatTokens(stats.afterApproxTokens)} tokens ` +
                theme.fg(change <= 0 ? "success" : "warning", `(${changeLabel})`),
              safeWidth,
            ),
          );
          lines.push(
            truncateToWidth(
              theme.fg(
                "dim",
                "↑↓ navigate · space cycle · k keep · s summarize · d drop · p pin · r reset · enter apply · esc cancel",
              ),
              safeWidth,
            ),
          );
          lines.push(theme.fg("borderMuted", "─".repeat(Math.max(1, safeWidth))));

          const visible = visibleRows();
          for (let index = scroll; index < Math.min(working.length, scroll + visible); index += 1) {
            const item = working[index]!;
            const cursor = index === selected ? theme.fg("accent", ">") : " ";
            const tokens = formatTokens(item.approxTokens).padStart(7);
            let row = `${cursor} ${renderAction(item.action)} ${theme.fg("dim", tokens)}  ${item.title}`;
            row = truncateToWidth(row, safeWidth);
            if (index === selected) row = theme.bg("selectedBg", row);
            lines.push(row);
          }

          while (lines.length < Math.min(terminalRows() - 6, visible + 4)) lines.push("");
          lines.push(theme.fg("borderMuted", "─".repeat(Math.max(1, safeWidth))));

          const current = working[selected];
          if (current) {
            lines.push(
              truncateToWidth(
                `${theme.bold(current.title)} ${theme.fg("dim", `· importance ${current.importance}/100 · ${current.messageCount} messages`)}`,
                safeWidth,
              ),
            );
            const summary = wrapTextWithAnsi(theme.fg("text", current.summary), safeWidth).slice(0, 2);
            lines.push(...summary);
            const reason = wrapTextWithAnsi(theme.fg("muted", `Why: ${current.reason}`), safeWidth).slice(0, 2);
            lines.push(...reason);
          }
          lines.push(
            truncateToWidth(
              theme.fg(
                "dim",
                `${stats.pinnedBlocks} pinned · ${stats.keptBlocks} kept · ${stats.summarizedBlocks} summarized · ${stats.droppedBlocks} dropped`,
              ),
              safeWidth,
            ),
          );
          return lines;
        },
        invalidate() {},
        handleInput(data: string) {
          const up = keybindings.matches(data, "tui.select.up");
          const down = keybindings.matches(data, "tui.select.down");
          const pageUp = keybindings.matches(data, "tui.editor.pageUp");
          const pageDown = keybindings.matches(data, "tui.editor.pageDown");
          const enter = keybindings.matches(data, "tui.select.confirm");
          const escape = keybindings.matches(data, "tui.select.cancel");

          if (data === "k" || data === "K") setAction("keep");
          else if (data === "s" || data === "S") setAction("summarize");
          else if (data === "d" || data === "D") setAction("drop");
          else if (data === "p" || data === "P") setAction("pin");
          else if (data === "r" || data === "R") {
            for (let index = 0; index < working.length; index += 1) {
              working[index]!.action = initial[index]?.suggestedAction ?? "keep";
            }
          } else if (data === " " || data === "space") {
            const item = working[selected];
            if (item) item.action = nextAction(item.action);
          } else if (up) selected = Math.max(0, selected - 1);
          else if (down) selected = Math.min(working.length - 1, selected + 1);
          else if (pageUp) selected = Math.max(0, selected - visibleRows());
          else if (pageDown) selected = Math.min(working.length - 1, selected + visibleRows());
          else if (enter) {
            done(clonePlans(working));
            return;
          } else if (escape) {
            done(null);
            return;
          } else {
            return;
          }

          keepSelectedVisible();
          tui.requestRender();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: { width: "100%", maxHeight: "100%", margin: 0 },
    },
  );
}
