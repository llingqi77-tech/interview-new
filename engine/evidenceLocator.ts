import type { Evidence, Message } from '../types.ts';

/**
 * 证据定位（PRD 7.：证据引用带时间戳，点击可定位到对应发言）
 * 报告里的证据只存 message_index；定位时按序号取回原话与上下文。
 */

export interface LocatedEvidence {
  index: number;
  message: Message | null;
  /** 前后各一条上下文 */
  context: Message[];
  /** 找不到时的兜底文案 */
  fallback: string;
}

export function locateEvidence(messages: Message[], evidence: Evidence): LocatedEvidence {
  const index = typeof evidence.message_index === 'number' ? evidence.message_index : -1;
  const message = index >= 0 && index < messages.length ? messages[index] : null;
  if (!message) {
    return {
      index,
      message: null,
      context: [],
      fallback: `未找到对应发言（时间戳 ${Math.round(evidence.timestamp_ms / 1000)}s）`,
    };
  }
  const from = Math.max(0, index - 1);
  const to = Math.min(messages.length, index + 2);
  return { index, message, context: messages.slice(from, to), fallback: '' };
}
