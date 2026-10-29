import type { PhaseId } from '../../types.ts';

export const TICK_MS = 250;

/** 阵型 B：审题 5s → 自我介绍 1min → 问答 8min → 收尾 2min */
export const PANEL_PHASE_DURATIONS_MS: Partial<Record<PhaseId, number>> = {
  READING: 5 * 1000,
  OPENING: 60 * 1000,
  FREE_DISCUSSION: 8 * 60 * 1000,
  SUMMARY: 2 * 60 * 1000,
};

/** panel 自我介绍说完后，自动进入问答的等待窗 */
export const PANEL_OPENING_ADVANCE_MS = 8_000;

/** 用户打断后，优先把话筒留给他的窗口 */
export const BARGE_IN_HOLD_MS = 12_000;
export const BARGE_IN_RETRY_MS = 2_000;

/** 上一位 Realtime 还在播时，推迟调度，避免两个人叠声 */
export const AI_PLAYING_RETRY_MS = 800;

export const TURN_DELAY_MIN_MS = 1_200;
export const TURN_DELAY_SPAN_MS = 1_500;
export const USER_REPLY_EXTRA_MIN_MS = 800;
export const USER_REPLY_EXTRA_SPAN_MS = 800;

/** 自由讨论冷场后，主持救场的沉默阈值和节流 */
export const HOST_NUDGE_SILENCE_MS = 20_000;
export const HOST_NUDGE_COOLDOWN_MS = 30_000;

/** 点名用户后，lgd 等到这个时长就改派其他人 */
export const USER_WAIT_LIMIT_MS = 8_000;

/** panel 给候选人更长的思考窗，再判定「点名未回应」 */
export const PANEL_NO_RESPONSE_MS = 15_000;

/** 审题阶段稍等再让主持开场，避免和进房动画抢第一句 */
export const READING_HOST_DELAY_MS = 500;
