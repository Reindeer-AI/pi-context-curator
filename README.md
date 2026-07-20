# pi-context-curator

Human-in-the-loop semantic context management for the [Pi coding agent](https://pi.dev).

Instead of replacing an old conversation prefix with one automatic summary, Context Curator builds an inventory of the active context and lets you decide what should remain visible to the model.

## Status

Early MVP. Context projection is non-destructive: the original Pi session remains in its JSONL history.

## Install

With npm from a local or remote Git repository:

```bash
npm install /absolute/path/to/pi-context-curator
npm install git+https://github.com/Reindeer-AI/pi-context-curator.git
```

Register a local checkout with Pi:

```bash
pi install /absolute/path/to/pi-context-curator
```

Try it for one run:

```bash
pi -e /absolute/path/to/pi-context-curator
```

The repository ships its TypeScript source and Pi package manifest directly, so Git installs do not require a build or `prepare` script.

## Usage

```text
/context-curate          Build a fresh semantic inventory and open the curator
/context-curate edit     Edit the existing inventory without another model call
/context-curate status   Show the active projection and estimated savings
/context-curate reset    Restore the full active context
/context-curate help     Show command help
```

Running `/compact` opens Context Curator instead of immediately applying native compaction. Automatic threshold compaction also opens it when no curation is active. Pi's native overflow recovery remains enabled as a safety fallback.

## Curator actions

| Action | Effect |
| --- | --- |
| `PIN` | Keep the block verbatim and protect that choice from future inventory recommendations until you explicitly change it. |
| `KEEP` | Keep the block verbatim for this projection, but let a fresh future inventory recommend another action. |
| `SUMMARIZE` | Replace the block in outgoing model context with its semantic summary and a recall reference. |
| `DROP` | Remove the block from outgoing model context. |

Inside the curator:

```text
↑/↓     navigate
Space   cycle action
k       keep
s       summarize
d       drop
p       pin
r       reset model recommendations
Enter   apply
Esc     cancel
```

## Recall

Summarized blocks contain a stable block ID. The model can use the `context_recall` tool to recover exact original content:

```json
{
  "block_id": "user:1712345678:abcd1234",
  "offset": 0,
  "limit": 20000
}
```

The source session remains unchanged; only the message projection sent to the provider is transformed.

## How it works

1. Split the active Pi context into user-turn blocks, keeping assistant/tool sequences atomic.
2. Ask the active model for a structured semantic inventory: title, continuation-quality summary, importance, suggested action, and rationale.
3. Present every block in a full-screen TUI with projected token savings.
4. Persist the selected plan as a Pi custom session entry.
5. Apply the plan through Pi's `context` event before each provider request.
6. Leave future, uncatalogued turns visible by default.
7. Build later inventories from the current curated projection, so dropped material stays hidden and summarized material stays summarized.

The latest block is always recommended as `PIN`. A fresh `/context-curate` may reconsider blocks marked `KEEP`, while `PIN` remains pinned. `/context-curate edit` preserves every current action exactly. If semantic analysis fails or no model credentials are available, the extension falls back to conservative deterministic recommendations.

## Safety properties

- Original session entries are never rewritten or deleted.
- Entire user-turn/tool chains are projected together, avoiding orphaned tool calls.
- Newly appended turns default to `KEEP` until the next curation.
- Re-curation preserves hidden `DROP` decisions; use `/context-curate reset` to restore the raw projection.
- Projection changes only when the user applies a plan, limiting prompt-cache churn.
- Overflow recovery falls back to Pi's native compaction.
- Invalid or incomplete model inventory output falls back safely.

## Configuration

Optional environment variables:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `PI_CONTEXT_CURATOR_ANALYSIS_MAX_CHARS` | `180000` | Maximum source characters budgeted across inventory blocks. |
| `PI_CONTEXT_CURATOR_BLOCK_MAX_CHARS` | `12000` | Maximum characters sampled from one block for inventory analysis. |

## Known limitations

- Token counts are estimates for conversation messages and exclude provider-specific system/tool-schema overhead.
- Blocks are user-turn based in the MVP; topic clustering across multiple turns is planned.
- The semantic inventory covers conversation messages, not the system prompt or active tool schemas.
- A native compaction can make very old raw content unavailable to the active context builder, although it remains in the session history when recoverable from entries.
- Multiple extensions that transform Pi's `context` event are order-dependent.
- Semantic inventory generation sends sampled active context to the selected model.

## Development

```bash
npm install
npm run verify
```

The package is loaded directly from TypeScript; no build step is required.

## Prior art

The design builds on ideas demonstrated by `pi-context-manager`, `pi-reduce`, `pi-condense`, `pi-dcp`, `pi-smart-compact`, OpenCode DCP, and Magic Compact. Context Curator focuses specifically on semantic, human-reviewed, reversible, non-contiguous context projection.

## License

MIT
