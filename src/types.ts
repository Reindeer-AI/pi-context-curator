import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const CURATION_ACTIONS = ["keep", "summarize", "drop", "pin"] as const;

export type CurationAction = (typeof CURATION_ACTIONS)[number];

export interface ContextBlock {
  id: string;
  index: number;
  messages: AgentMessage[];
  approxTokens: number;
  restoreApproxTokens?: number;
  fallbackTitle: string;
  startTimestamp: number;
}

export interface BlockAnalysis {
  id: string;
  title: string;
  summary: string;
  reason: string;
  suggestedAction: CurationAction;
  importance: number;
}

export interface CuratedBlockPlan extends BlockAnalysis {
  action: CurationAction;
  approxTokens: number;
  messageCount: number;
}

export interface PersistedCurationState {
  version: 1;
  enabled: boolean;
  createdAt: string;
  sourceLeafId?: string;
  model?: string;
  beforeApproxTokens: number;
  afterApproxTokens: number;
  blocks: CuratedBlockPlan[];
}

export interface ProjectionStats {
  beforeApproxTokens: number;
  afterApproxTokens: number;
  keptBlocks: number;
  summarizedBlocks: number;
  droppedBlocks: number;
  pinnedBlocks: number;
}

export interface AnalysisResult {
  analyses: BlockAnalysis[];
  model?: string;
  usedFallback: boolean;
  warning?: string;
}
