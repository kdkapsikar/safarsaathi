import type { ProposalView, ToolContext } from './tools.js';

export type AssistantEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'start' | 'done' | 'error' }
  | { type: 'proposal'; proposal: ProposalView }
  | { type: 'notice'; message: string }
  | { type: 'done'; sessionId: string | null; mode: 'claude' | 'offline' }
  | { type: 'error'; message: string };

export type Emit = (event: AssistantEvent) => void;

export interface HistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface Turn {
  message: string;
  history: HistoryTurn[];
  ctx: ToolContext;
  emit: Emit;
  signal: AbortSignal;
}

export interface TurnResult {
  text: string;
  proposals: ProposalView[];
  /** Input + output tokens billed (0 offline). */
  tokens: number;
}

export interface AssistantEngine {
  readonly mode: 'claude' | 'offline';
  respond(turn: Turn): Promise<TurnResult>;
}
