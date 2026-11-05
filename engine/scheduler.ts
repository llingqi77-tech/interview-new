/**
 * 发言权调度器（PRD 5. 自由讨论）
 *
 * - 系统随机分配调度权给其他三个 AI 角色，尽量次数平均
 * - 真人可随时打断/抢话（点击麦克风即代表要抢话）
 * - AI 暂不需要打断真人
 */

export interface Scheduler {
  /** 取下一个发言的 AI */
  next(): string;
  /** 本轮还没发过言的 AI */
  remaining(): string[];
  /** 重新洗牌（新一轮） */
  reshuffle(): void;
}

function seededRandom(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) % 2147483647;
  if (s === 0) s = 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1)) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 洗牌袋调度：每轮把全部 AI 洗一次牌依次发完，再洗下一轮。
 * 保证任意时刻各 AI 被分配次数之差 ≤ 1，同时顺序随机。
 */
export function createScheduler(ids: string[], seed = Date.now()): Scheduler {
  const rand = seededRandom(seed);
  let bag: string[] = [];

  const refill = () => {
    bag = shuffle(ids, rand);
  };
  refill();

  return {
    next() {
      if (bag.length === 0) refill();
      return bag.shift() as string;
    },
    remaining() {
      return [...bag];
    },
    reshuffle() {
      refill();
    },
  };
}

export interface FloorRequest {
  granted: boolean;
  /** 被抢话的 AI（无人发言时为 null） */
  interrupted: string | null;
  reason: string;
}

/** 真人点击麦克风抢话 */
export function requestFloor(input: { speakingId?: string | null; phase?: string }): FloorRequest {
  if (input.phase === 'READING') {
    return { granted: false, interrupted: null, reason: '审题阶段暂不发言' };
  }
  return {
    granted: true,
    interrupted: input.speakingId ?? null,
    reason: input.speakingId ? '真人抢话，打断当前 AI' : '真人取得发言权',
  };
}

/** AI 是否可以打断某人（AI 不打断真人） */
export function canAiInterrupt(speakerId: string): boolean {
  return speakerId !== 'user';
}
