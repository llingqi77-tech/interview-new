import { guidesToNextKeyPoint, proposesSummary } from './discourseSignals.ts';
import { MAX_DISCUSSIONS_PER_KEY_POINT } from './keyPoints.ts';

/**
 * 群面要点游标。
 * 每条有效发言记一次；满 10 次，或台词明确引导下一段，就推进。
 * panel 不跟踪要点：reset([]) 后所有方法都是空操作。
 */
export class KeyPointTracker {
  #points: string[] = [];
  #index = 0;
  #discussionCount = 0;

  reset(points: readonly string[] | null | undefined): void {
    this.#points = Array.isArray(points) ? [...points] : [];
    this.#index = 0;
    this.#discussionCount = 0;
  }

  get points(): readonly string[] {
    return this.#points;
  }

  get index(): number {
    return this.#index;
  }

  get discussionCount(): number {
    return this.#discussionCount;
  }

  get current(): string | null {
    return this.#points[this.#index] ?? null;
  }

  get allDiscussed(): boolean {
    return this.#index >= this.#points.length;
  }

  /** 当前要点还没讨论完时，每条消息（AI + 用户）记一次 */
  noteUtterance(): void {
    if (!this.isTracking) return;
    this.#discussionCount += 1;
  }

  /**
   * 达到上限或明确引导到下一要点时推进。
   * 返回 true 表示当前要点变了，调用方要刷新快照。
   */
  advanceIfReady(content: string): boolean {
    if (!this.isTracking) return false;
    const reachedCap = this.#discussionCount >= MAX_DISCUSSIONS_PER_KEY_POINT;
    if (!reachedCap && !guidesToNextKeyPoint(content)) return false;
    if (this.#index + 1 < this.#points.length) {
      this.#index += 1;
      this.#discussionCount = 0;
    } else {
      this.#index = this.#points.length;
    }
    return true;
  }

  /** 总结引导 +（要点已尽或阶段已过 80%）才允许关键词兜底切阶段 */
  shouldAdvancePhase(content: string, phaseProgressRatio: number): boolean {
    if (!proposesSummary(content)) return false;
    return this.allDiscussed || phaseProgressRatio > 0.8;
  }

  private get isTracking(): boolean {
    return this.#points.length > 0 && this.#index < this.#points.length;
  }
}
