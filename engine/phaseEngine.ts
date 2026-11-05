import type { GameEvent, InterviewFormat, PhaseDef, PhaseId } from '../types.ts';

/**
 * 双模式阶段引擎（PRD 5. / 6.）
 *
 * 群面：审题 3min → 自我介绍 每人 1min（共 4min）→ 自由讨论 15min → 总结陈词 3min
 * 单面：自我介绍 1min → 面试官问答 8-10min → 反问 2min
 *
 * - 倒计时是阶段推进的主信号，到点强制切换
 * - 阶段结束前 1 分钟给出时间提醒（time_warning）
 * - 自由讨论最后 3 分钟给出收尾提示（wrap_up）
 * - 每次切换都带 beep 标记，UI 据此播放提示音并更新状态栏
 */

/** 阶段结束前提醒阈值 */
export const WARNING_MS = 60000;
/** 自我介绍每人时长 */
export const INTRO_TURN_MS = 60000;
/** 自由讨论收尾提示阈值 */
export const FREE_WRAP_MS = 180000;
/** 单面问答时长区间 */
export const PANEL_QA_MIN_MS = 480000;
export const PANEL_QA_MAX_MS = 600000;
export const PANEL_QA_DEFAULT_MS = 540000;
/** 反问允许的问题数量 */
export const COUNTER_ASK_RANGE = [2, 3] as const;
/** 单面自我介绍弹窗提示（PRD 6.） */
export const PANEL_INTRO_PROMPT = '请用一分钟介绍你的学历、专业背景和过往经历。';

export const LGD_PHASES: PhaseDef[] = [
  {
    id: 'READING',
    order: 1,
    label: '审题',
    promptPhase: '审题阶段（阅读题目，暂不发言）',
    durationMs: 3 * 60 * 1000,
    allowSpeech: false,
    description: '阅读题目，暂不发言。3 分钟后自动进入自我介绍。',
  },
  {
    id: 'INTRO',
    order: 2,
    label: '自我介绍',
    promptPhase: '自我介绍阶段',
    durationMs: 4 * 60 * 1000,
    allowSpeech: true,
    description: '每人 1 分钟，先由真人开始，可一键跳过 AI 候选人。',
  },
  {
    id: 'FREE_DISCUSSION',
    order: 3,
    label: '自由讨论',
    promptPhase: '深入讨论与方案贡献',
    durationMs: 15 * 60 * 1000,
    allowSpeech: true,
    description: '按要点顺序深入讨论，最后 3 分钟收尾并确认总结人。',
  },
  {
    id: 'SUMMARY',
    order: 4,
    label: '总结陈词',
    promptPhase: '引导与总结陈词',
    durationMs: 3 * 60 * 1000,
    allowSpeech: true,
    description: '由调度器分配的角色做总结；真人主动争取则改由真人总结。',
  },
];

export const PANEL_PHASES: PhaseDef[] = [
  {
    id: 'SELF_INTRO',
    order: 1,
    label: '自我介绍',
    promptPhase: '候选人自我介绍',
    durationMs: 60000,
    allowSpeech: true,
    description: '1 分钟介绍学历、专业背景和过往经历。',
  },
  {
    id: 'QA',
    order: 2,
    label: '面试官问答',
    promptPhase: '面试官提问与追问',
    durationMs: PANEL_QA_DEFAULT_MS,
    allowSpeech: true,
    description: '主面试官问专业知识与过往经历，副面试官问职业意愿与规划，轮流提问并追问。',
  },
  {
    id: 'COUNTER_ASK',
    order: 3,
    label: '反问面试官',
    promptPhase: '候选人反问',
    durationMs: 120000,
    allowSpeech: true,
    description: '可向面试官提 2 到 3 个问题。',
  },
];

export interface PhaseConfig {
  /** 阶段时长覆盖（测试用） */
  durationsMs?: Partial<Record<PhaseId, number>>;
  /** 自我介绍发言顺序（speaker id 列表，'user' 表示真人） */
  openingOrder?: string[];
}

export interface PhaseState {
  format: InterviewFormat;
  phaseIndex: number;
  phaseStartedAt: number;
  /** 自我介绍当前发言者下标 */
  openingIndex: number;
  openingStartedAt: number;
  /** 本阶段是否已发过 1 分钟提醒 */
  warned: boolean;
  /** 自由讨论是否已发过收尾提示 */
  wrapped: boolean;
  finished: boolean;
}

export interface TickResult {
  state: PhaseState;
  events: GameEvent[];
  changed: boolean;
}

export function getPhaseDefs(format: InterviewFormat = 'lgd', config?: PhaseConfig): PhaseDef[] {
  const base = format === 'panel' ? PANEL_PHASES : LGD_PHASES;
  if (!config?.durationsMs) return base;
  return base.map((p) => ({ ...p, durationMs: config.durationsMs?.[p.id] ?? p.durationMs }));
}

export function initPhaseEngine(now: number, format: InterviewFormat = 'lgd', _config?: PhaseConfig): PhaseState {
  return {
    format,
    phaseIndex: 0,
    phaseStartedAt: now,
    openingIndex: 0,
    openingStartedAt: now,
    warned: false,
    wrapped: false,
    finished: false,
  };
}

export function currentPhase(state: PhaseState, format?: InterviewFormat, config?: PhaseConfig): PhaseDef {
  const defs = getPhaseDefs(format ?? state.format, config);
  return defs[Math.min(state.phaseIndex, defs.length - 1)];
}

export function phaseRemainingMs(state: PhaseState, now: number, format?: InterviewFormat, config?: PhaseConfig): number {
  const def = currentPhase(state, format, config);
  return Math.max(0, def.durationMs - (now - state.phaseStartedAt));
}

export function phaseProgress(state: PhaseState, now: number, format?: InterviewFormat, config?: PhaseConfig): number {
  const def = currentPhase(state, format, config);
  const elapsed = now - state.phaseStartedAt;
  return Math.min(1, Math.max(0, elapsed / def.durationMs));
}

/** 自我介绍当前发言者（仅 INTRO 阶段有效） */
export function currentOpeningSpeaker(state: PhaseState, config?: PhaseConfig, format?: InterviewFormat): string | null {
  const order = config?.openingOrder ?? [];
  if (currentPhase(state, format, config).id !== 'INTRO') return null;
  if (state.openingIndex >= order.length) return null;
  return order[state.openingIndex];
}

/** 默认真人先讲，然后才是 AI 候选人 */
export function defaultOpeningOrder(candidateIds: string[]): string[] {
  return ['user', ...candidateIds];
}

/** 阶段紧急度 0-1（发言权调度用） */
export function stageUrgency(state: PhaseState, now: number, format?: InterviewFormat, config?: PhaseConfig): number {
  if (state.finished) return 1;
  const def = currentPhase(state, format, config);
  const elapsed = now - state.phaseStartedAt;
  if (def.id === 'FREE_DISCUSSION') {
    const remain = def.durationMs - elapsed;
    return remain <= FREE_WRAP_MS ? Math.min(1, (FREE_WRAP_MS - remain) / FREE_WRAP_MS) : 0;
  }
  return Math.min(1, Math.max(0, elapsed / def.durationMs));
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function makeEvent(
  type: GameEvent['event_type'],
  actor: string,
  target: string,
  atMs: number,
  metadata?: Record<string, unknown>
): GameEvent {
  return { event_type: type, actor, target, timestamp_ms: atMs, metadata };
}

function stageChangeEvent(def: PhaseDef, atMs: number, metadata: Record<string, unknown>): GameEvent {
  return makeEvent('stage_change', 'system', def.id, atMs, {
    beep: true,
    phaseLabel: def.label,
    phaseOrder: def.order,
    ...metadata,
  });
}

/**
 * 推进引擎。倒计时到点必须切换（倒计时优先于关键词检测）。
 */
export function tickPhase(
  state: PhaseState,
  now: number,
  format?: InterviewFormat,
  config?: PhaseConfig,
  sessionStartAt: number = now
): TickResult {
  if (state.finished) return { state, events: [], changed: false };

  const fmt = format ?? state.format;
  const defs = getPhaseDefs(fmt, config);
  const def = defs[Math.min(state.phaseIndex, defs.length - 1)];
  const events: GameEvent[] = [];
  const at = now - sessionStartAt;
  const elapsed = now - state.phaseStartedAt;
  const remaining = def.durationMs - elapsed;
  let next = state;

  // 1) 自我介绍：按人推进
  if (def.id === 'INTRO') {
    const order = config?.openingOrder ?? [];
    const turnElapsed = now - state.openingStartedAt;
    if (turnElapsed >= INTRO_TURN_MS || state.openingIndex >= order.length) {
      if (state.openingIndex + 1 < order.length) {
        next = { ...next, openingIndex: state.openingIndex + 1, openingStartedAt: now };
        events.push(
          makeEvent('speak_grant', order[next.openingIndex], 'all', at, {
            reason: 'intro_turn',
            turn: next.openingIndex,
          })
        );
        return { state: next, events, changed: true };
      }
      const nextIndex = Math.min(state.phaseIndex + 1, defs.length - 1);
      next = {
        ...next,
        phaseIndex: nextIndex,
        phaseStartedAt: now,
        openingIndex: 0,
        openingStartedAt: now,
        warned: false,
        wrapped: false,
      };
      events.push(stageChangeEvent(defs[nextIndex], at, { reason: 'intro_done', from: def.id }));
      return { state: next, events, changed: true };
    }
    return { state, events: [], changed: false };
  }

  // 2) 到点切换
  if (elapsed >= def.durationMs) {
    const nextIndex = state.phaseIndex + 1;
    if (nextIndex >= defs.length) {
      next = { ...next, finished: true };
      events.push(
        makeEvent('stage_change', 'system', 'FINISHED', at, {
          beep: true,
          phaseLabel: '已结束',
          reason: 'countdown_end',
          from: def.id,
        })
      );
      return { state: next, events, changed: true };
    }
    next = {
      ...next,
      phaseIndex: nextIndex,
      phaseStartedAt: now,
      openingIndex: 0,
      openingStartedAt: now,
      warned: false,
      wrapped: false,
    };
    events.push(stageChangeEvent(defs[nextIndex], at, { reason: 'countdown', from: def.id }));
    return { state: next, events, changed: true };
  }

  // 3) 自由讨论最后 3 分钟收尾提示
  if (def.id === 'FREE_DISCUSSION' && !state.wrapped && remaining <= FREE_WRAP_MS) {
    next = { ...next, wrapped: true };
    events.push(
      makeEvent('wrap_up', 'host', 'all', at, {
        reason: 'free_wrap',
        remainingMs: remaining,
        script: 'free->wrap',
      })
    );
  }

  // 4) 结束前 1 分钟提醒
  if (!state.warned && remaining <= WARNING_MS) {
    next = { ...next, warned: true };
    events.push(
      makeEvent('time_warning', 'host', 'all', at, {
        reason: 'one_minute_left',
        remainingMs: remaining,
        phaseLabel: def.label,
      })
    );
  }

  return { state: next, events, changed: next !== state };
}

/** 一键跳过所有 AI 候选人的自我介绍（真人说完后直接进自由讨论） */
export function skipAiIntro(
  state: PhaseState,
  now: number,
  format?: InterviewFormat,
  config?: PhaseConfig,
  sessionStartAt: number = now
): TickResult {
  const fmt = format ?? state.format;
  const defs = getPhaseDefs(fmt, config);
  const def = defs[Math.min(state.phaseIndex, defs.length - 1)];
  if (def.id !== 'INTRO') return { state, events: [], changed: false };
  const nextIndex = Math.min(state.phaseIndex + 1, defs.length - 1);
  const next: PhaseState = {
    ...state,
    phaseIndex: nextIndex,
    phaseStartedAt: now,
    openingIndex: 0,
    openingStartedAt: now,
    warned: false,
    wrapped: false,
  };
  return {
    state: next,
    events: [stageChangeEvent(defs[nextIndex], now - sessionStartAt, { reason: 'skip_ai_intro', from: def.id })],
    changed: true,
  };
}

/**
 * 关键词辅助推进（兜底）：仅在倒计时未到点且满足关键词条件时允许提前进入下一阶段。
 */
export function advancePhaseByKeyword(
  state: PhaseState,
  now: number,
  format?: InterviewFormat,
  config?: PhaseConfig,
  sessionStartAt: number = now
): TickResult {
  if (state.finished) return { state, events: [], changed: false };
  const fmt = format ?? state.format;
  const defs = getPhaseDefs(fmt, config);
  const def = defs[Math.min(state.phaseIndex, defs.length - 1)];
  if (def.id !== 'FREE_DISCUSSION') return { state, events: [], changed: false };
  const nextIndex = state.phaseIndex + 1;
  if (nextIndex >= defs.length) return { state, events: [], changed: false };
  const next: PhaseState = {
    ...state,
    phaseIndex: nextIndex,
    phaseStartedAt: now,
    warned: false,
    wrapped: false,
  };
  return {
    state: next,
    events: [stageChangeEvent(defs[nextIndex], now - sessionStartAt, { reason: 'keyword', from: def.id })],
    changed: true,
  };
}

/** 阶段切换引导语 key（供 UI 直接取台词） */
export function transitionKey(format: InterviewFormat, from: PhaseId | 'OPEN', to: PhaseId | 'FINISHED'): string {
  if (format === 'panel') {
    if (from === 'OPEN') return 'open->intro';
    if (from === 'SELF_INTRO') return 'intro->qa';
    if (from === 'QA') return to === 'COUNTER_ASK' ? 'qa->counter' : 'qa->rotate';
    return 'counter->end';
  }
  if (from === 'OPEN') return 'open->reading';
  if (from === 'READING') return 'reading->intro';
  if (from === 'INTRO') return 'intro->free';
  if (from === 'FREE_DISCUSSION') return to === 'SUMMARY' ? 'free->summary' : 'free->wrap';
  return 'summary->end';
}
