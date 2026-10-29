/** 面后分析前等待在途落库的上限，避免数据库挂死拖住收尾 */
export const SAVE_FLUSH_TIMEOUT_MS = 3_000;

export type SaveErrorHandler = (error: unknown) => void;

function logSaveError(error: unknown): void {
  console.error('落库失败:', error);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 在途落库队列。
 * 单次失败只记日志，不阻断面试；收尾时等齐，但最多等 SAVE_FLUSH_TIMEOUT_MS。
 */
export class SaveQueue {
  #pending: Promise<unknown>[] = [];
  readonly #onError: SaveErrorHandler;

  constructor(onError: SaveErrorHandler = logSaveError) {
    this.#onError = onError;
  }

  get size(): number {
    return this.#pending.length;
  }

  track(task: Promise<unknown>): void {
    this.#pending.push(Promise.resolve(task).catch((error) => this.#onError(error)));
  }

  async flush(timeoutMs = SAVE_FLUSH_TIMEOUT_MS): Promise<void> {
    if (this.#pending.length === 0) return;
    const batch = this.#pending;
    this.#pending = [];
    const limit = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : SAVE_FLUSH_TIMEOUT_MS;
    await Promise.race([Promise.allSettled(batch), wait(limit)]);
  }
}
