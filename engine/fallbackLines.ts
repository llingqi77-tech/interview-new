import type { InterviewFormat } from '../types.ts';

/**
 * LLM 不可用时的兜底台词（PRD 4.：LLM/语音异常时自动降级，讨论仍可继续）
 * 只保证流程不断，不假装是 AI 的实时生成内容。
 */

export type FallbackKind = 'host' | 'interviewer' | 'candidate';

const LGD_CANDIDATE_LINES = [
  '我先接一下刚才的观点：我同意方向，但成本这块还需要一个量化的口径，不然我们没法比较方案。',
  '我补充一个不同角度：如果只看时效，风险会被低估，建议把风险单独列一条来判断。',
  '我理解你的意思，不过我想质疑一点——这个结论在极端情况下还成立吗？',
  '我们把已经达成一致的部分先记下来，剩下的分歧按优先级排一下。',
];

const PANEL_INTERVIEWER_LINES = [
  '请举一个你亲自负责的具体例子，说明当时的背景、你的任务、你做了什么，以及最后的结果。',
  '这个结果有量化数据吗？如果重来一次，你会在哪一步做得不一样？',
  '你刚才提到的取舍，当时还有哪些备选方案？为什么最终选了这个？',
  '换个角度：如果资源只有现在的一半，你会怎么调整？',
];

const HOST_LINES = [
  '我们继续，请注意时间。',
  '还有哪位想补充？',
  '时间过半，请大家聚焦到还没达成一致的点上。',
];

export function fallbackLine(kind: FallbackKind, format: InterviewFormat, seed = Date.now()): string {
  const pool = kind === 'host' ? HOST_LINES : kind === 'interviewer' || format === 'panel' ? PANEL_INTERVIEWER_LINES : LGD_CANDIDATE_LINES;
  return pool[Math.abs(Math.floor(seed)) % pool.length];
}
