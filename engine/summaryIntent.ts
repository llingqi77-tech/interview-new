/**
 * 总结陈词归属（PRD 5. 总结陈词）
 *
 * 自由讨论最后阶段由调度器分配某个角色总结；
 * 但真人一旦主动说「我来总结」，系统改由真人总结，并给表现加分。
 */

/** 主动争取总结的加分（计入领导与影响力 / 结构贡献） */
export const SUMMARY_BONUS = 6;

const SUMMARY_PATTERNS = [
  /我来(做|来|负责)?(这个|一下)?总结/,
  /我(来|做)(一下)?(汇报|总结陈词)/,
  /让我来总结/,
  /我申请(做|来)?总结/,
  /总结(的)?部分(我|由我)来/,
  /那我来(总结|汇报)/,
];

export function detectSummaryIntent(text: string): boolean {
  if (!text) return false;
  const t = text.replace(/\s+/g, '');
  return SUMMARY_PATTERNS.some((re) => re.test(t));
}

function seededIndex(seed: number, len: number): number {
  const s = Math.abs(Math.floor(seed)) % 2147483647;
  return len ? s % len : 0;
}

/** 调度器分配总结角色（无真人主动争取时） */
export function assignSummarizer(input: { candidates: string[]; seed?: number }): string {
  if (input.candidates.length === 0) return 'user';
  return input.candidates[seededIndex(input.seed ?? Date.now(), input.candidates.length)];
}

export interface SummarizerDecision {
  speakerId: string;
  byUser: boolean;
  bonus: number;
}

/** 综合判定：真人主动争取优先 */
export function resolveSummarizer(input: {
  candidates: string[];
  seed?: number;
  userText?: string;
}): SummarizerDecision {
  if (input.userText && detectSummaryIntent(input.userText)) {
    return { speakerId: 'user', byUser: true, bonus: SUMMARY_BONUS };
  }
  return { speakerId: assignSummarizer({ candidates: input.candidates, seed: input.seed }), byUser: false, bonus: 0 };
}
