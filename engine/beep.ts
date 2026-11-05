/**
 * 倒计时提示音（PRD 4.：面试里面的每个小阶段，都需要有倒计时提示音）
 *
 * 每个阶段产生两类提示音：
 * - warning：结束前 1 分钟
 * - end：到点
 * 阶段切换时由 UI 层统一播放，避免每个阶段各写一套定时器。
 */

export type BeepKind = 'warning' | 'end' | 'tick' | 'start';

export const BEEP_KINDS: BeepKind[] = ['start', 'warning', 'end', 'tick'];

export interface BeepCue {
  kind: BeepKind;
  /** 相对阶段开始的毫秒数 */
  atMs: number;
  /** 提示音频率（Hz），UI 用 WebAudio 合成，不依赖音频文件 */
  frequency: number;
  /** 时长（ms） */
  durationMs: number;
}

export const BEEP_TONES: Record<BeepKind, { frequency: number; durationMs: number }> = {
  start: { frequency: 880, durationMs: 120 },
  warning: { frequency: 660, durationMs: 180 },
  end: { frequency: 440, durationMs: 320 },
  tick: { frequency: 520, durationMs: 60 },
};

/**
 * 某阶段的提示音时间表。
 * @param input.durationMs 阶段总时长
 * @param input.warningMs  结束前多久提醒（默认 60s）
 */
export function beepCuesFor(input: { durationMs: number; warningMs?: number }): BeepCue[] {
  const warningMs = input.warningMs ?? 60000;
  const cues: BeepCue[] = [];
  const push = (kind: BeepKind, atMs: number) => {
    if (atMs < 0 || atMs > input.durationMs) return;
    cues.push({ kind, atMs, ...BEEP_TONES[kind] });
  };
  push('start', 0);
  if (input.durationMs > warningMs) push('warning', input.durationMs - warningMs);
  push('end', input.durationMs);
  return cues;
}

/** 到点前最后 5 秒的滴答（可选，UI 按需开启） */
export function tickCuesFor(durationMs: number, seconds = 5): BeepCue[] {
  const cues: BeepCue[] = [];
  for (let i = seconds; i >= 1; i--) {
    const atMs = durationMs - i * 1000;
    if (atMs < 0) continue;
    cues.push({ kind: 'tick', atMs, ...BEEP_TONES.tick });
  }
  return cues;
}
