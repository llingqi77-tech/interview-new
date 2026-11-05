/**
 * 结构化单面的提问轮换（PRD 6. 面试官问答）
 * 主面试官负责专业知识与过往经历，副面试官负责职业意愿与职业规划，两人轮流提问并追问。
 */

export interface PanelTurn {
  /** 下一位提问的面试官 id */
  next(): string;
  /** 当前提问者 */
  current(): string;
  /** 是否允许追问（同一面试官连续追问，最多 maxFollowUps 次） */
  canFollowUp(): boolean;
  /** 记录一次追问 */
  followUp(): string;
  /** 追问次数上限 */
  maxFollowUps: number;
}

export function createPanelTurn(ids: string[], maxFollowUps = 2): PanelTurn {
  const order = ids.length ? ids : ['lead', 'support'];
  let index = 0;
  let followUps = 0;
  return {
    maxFollowUps,
    next() {
      index = (index + 1) % order.length;
      followUps = 0;
      return order[index];
    },
    current() {
      return order[index];
    },
    canFollowUp() {
      return followUps < maxFollowUps;
    },
    followUp() {
      followUps += 1;
      return order[index];
    },
  };
}
