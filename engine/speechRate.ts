/**
 * 口语时长口径（2.8 字/秒）。
 * 会话发言窗口和面后报告共用这一处，避免两边各写一个魔法数。
 */

export const SPEECH_CHARS_PER_SECOND = 2.8;

/** 打断窗口 / 消息时间戳的下限：短句也给 800ms，避免窗口瞬间关闭 */
export const MIN_SPEECH_WINDOW_MS = 800;

/** 用户说完后，AI 接话等待的上限，避免长文拖慢调度 */
export const MAX_USER_REPLY_WAIT_MS = 6_000;

/** Realtime 播完回调丢失时，高亮悬挂的额外兜底 */
export const PLAYBACK_FALLBACK_SLACK_MS = 1_500;

export function speechMsFromCharCount(charCount: number): number {
  if (!Number.isFinite(charCount) || charCount <= 0) return 0;
  return (charCount / SPEECH_CHARS_PER_SECOND) * 1000;
}

/** 估算一段台词要说多久。空文本、非字符串都落到下限，不抛异常。 */
export function estimateSpeechMs(text: string | null | undefined): number {
  const length = typeof text === 'string' ? text.length : 0;
  return Math.max(MIN_SPEECH_WINDOW_MS, speechMsFromCharCount(length));
}

export function userReplyDelayMs(text: string | null | undefined): number {
  return Math.min(MAX_USER_REPLY_WAIT_MS, estimateSpeechMs(text));
}

export function playbackFallbackMs(text: string | null | undefined): number {
  return estimateSpeechMs(text) + PLAYBACK_FALLBACK_SLACK_MS;
}
