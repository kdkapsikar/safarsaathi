import type { Config } from '../config.js';
import type { DataAccess, User } from '../data/index.js';
import type { Clock } from '../trains/time.js';
import type { TrainDataProvider } from '../trains/types.js';
import { ClaudeAssistant } from './claude.js';
import { DailyTokenBudget, HourlyLimiter } from './limits.js';
import { OfflineAssistant } from './offline.js';
import type { ToolContext } from './tools.js';
import type { AssistantEngine, Emit, HistoryTurn } from './types.js';

export interface ChatRequest {
  message: string;
  user: User | null;
  ip: string;
  /** Signed-in users: continue this saved conversation. */
  sessionId?: string;
  /** Anonymous visitors: recent turns kept in the browser. */
  history?: HistoryTurn[];
  emit: Emit;
  signal: AbortSignal;
}

export type ChatRejection = { code: 'RATE_LIMITED'; message: string };

export interface AssistantDeps {
  config: Config;
  data: DataAccess;
  provider: TrainDataProvider;
  clock: Clock;
  /** Override for tests (e.g. a Claude engine with a mocked client). */
  engine?: AssistantEngine;
}

export class AssistantService {
  readonly offline = new OfflineAssistant();
  readonly primary: AssistantEngine;
  private readonly users = new HourlyLimiter();
  private readonly ips = new HourlyLimiter();
  readonly budget: DailyTokenBudget;

  constructor(private readonly deps: AssistantDeps) {
    const { config } = deps;
    this.primary =
      deps.engine ?? (config.ANTHROPIC_API_KEY ? new ClaudeAssistant(config) : this.offline);
    this.budget = new DailyTokenBudget(config.ASSISTANT_DAILY_TOKEN_CAP);
  }

  get mode(): 'claude' | 'offline' {
    return this.primary.mode;
  }

  /** Checked before the response starts streaming, so a 429 can still be a normal reply. */
  admit(user: User | null, ip: string): ChatRejection | null {
    const { config } = this.deps;
    const ok = user
      ? this.users.allow(`u:${user.id}`, config.ASSISTANT_USER_HOURLY_LIMIT)
      : this.ips.allow(`ip:${ip}`, config.ASSISTANT_IP_HOURLY_LIMIT);
    return ok
      ? null
      : {
          code: 'RATE_LIMITED',
          message: user
            ? "You've sent a lot of messages this hour. Please try again a bit later."
            : 'Too many messages from this network. Sign in for a higher limit, or try again later.',
        };
  }

  async chat(req: ChatRequest): Promise<void> {
    const { data, provider, clock, config } = this.deps;
    const mine = req.user ? data.forUser(req.user.id) : null;

    // History: from the user's saved conversation, or from the browser for visitors.
    let sessionId: string | null = null;
    let history: HistoryTurn[];
    if (mine) {
      const existing = req.sessionId ? mine.chat.getMessages(req.sessionId) : null;
      sessionId = existing ? req.sessionId! : mine.chat.createSession(req.message.slice(0, 80)).id;
      history = (existing ?? []).flatMap((m) =>
        m.role === 'user' || m.role === 'assistant'
          ? [{ role: m.role, text: (m.content as { text?: string }).text ?? '' }]
          : [],
      );
      mine.chat.appendMessage(sessionId, { role: 'user', content: { text: req.message } });
    } else {
      history = req.history ?? [];
    }
    history = history.filter((h) => h.text).slice(-config.ASSISTANT_HISTORY_TURNS * 2);

    const ctx: ToolContext = { user: req.user, mine, provider, now: clock.now() };
    let engine = this.primary;
    if (engine.mode === 'claude' && this.budget.exhausted()) {
      engine = this.offline;
      req.emit({ type: 'notice', message: 'Saathi is in basic mode for the rest of today.' });
    }

    try {
      const result = await engine.respond({
        message: req.message,
        history,
        ctx,
        emit: req.emit,
        signal: req.signal,
      });
      this.budget.record(result.tokens);
      if (mine && sessionId) {
        mine.chat.appendMessage(sessionId, {
          role: 'assistant',
          content: { text: result.text, proposals: result.proposals },
        });
      }
      req.emit({ type: 'done', sessionId, mode: engine.mode });
    } catch (err) {
      if (req.signal.aborted) return;
      req.emit({
        type: 'error',
        message: "Sorry, I couldn't answer just now. Please try again in a moment.",
      });
      throw err;
    }
  }
}
