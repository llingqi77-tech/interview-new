/**
 * 自由讨论四段式（PRD 5. 自由讨论）
 *
 * 1. 开场，15 分钟的时间分配
 * 2. 对于方案的深入讨论，需要包含题目的所有要点，按照要点顺序进行讨论，期间出现争执需要讨论以达成一致
 * 3. 方案的最后收尾，为后续总结陈词做铺垫
 */

export type FreeSubstageId = 'open' | 'deepen' | 'converge' | 'wrap';

export interface FreeSubstage {
  id: FreeSubstageId;
  label: string;
  /** 喂给主持面试官与候选人的阶段指令 */
  instruction: string;
  /** 占自由讨论时长的比例 */
  ratio: number;
}

export const FREE_SUBSTAGES: FreeSubstage[] = [
  {
    id: 'open',
    label: '开场与时间分配',
    instruction: '开场：先明确 15 分钟的时间分配（例如 2 分钟对齐框架、10 分钟逐要点讨论、3 分钟收尾），并确认讨论顺序。',
    ratio: 0.15,
  },
  {
    id: 'deepen',
    label: '按要点深入讨论',
    instruction: '深入讨论：必须覆盖题目的所有要点，按照要点顺序逐个讨论，不要跳点；每讨论完一个要点做一次小结。',
    ratio: 0.55,
  },
  {
    id: 'converge',
    label: '争执收敛',
    instruction: '争执收敛：出现分歧时必须把双方理由摆出来，讨论以达成一致为目标，允许折中方案，不允许搁置。',
    ratio: 0.2,
  },
  {
    id: 'wrap',
    label: '收尾铺垫',
    instruction: '收尾：把已达成一致的结论整理成条目，为后续总结陈词做铺垫，并确认由谁来做总结。',
    ratio: 0.1,
  },
];

/** 按已用时长判断当前处于第几段 */
export function currentSubstage(elapsedMs: number, totalMs: number): FreeSubstage {
  const ratio = totalMs > 0 ? Math.min(1, Math.max(0, elapsedMs / totalMs)) : 0;
  let acc = 0;
  for (const stage of FREE_SUBSTAGES) {
    acc += stage.ratio;
    if (ratio < acc) return stage;
  }
  return FREE_SUBSTAGES[FREE_SUBSTAGES.length - 1];
}

/** 生成给 LLM 的讨论计划文本 */
export function discussionPlanPrompt(keyPoints: string[]): string {
  const points = keyPoints.length ? keyPoints.join('、') : '题目要点';
  return [
    '本场自由讨论按四段推进：',
    ...FREE_SUBSTAGES.map((s, i) => `${i + 1}. ${s.label}：${s.instruction}`),
    `题目要点顺序：${points}。`,
  ].join('\n');
}
