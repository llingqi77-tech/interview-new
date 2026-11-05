/**
 * 带超时的 fetch（PRD 4.：LLM/语音异常时自动降级，讨论仍可继续）
 * 浏览器原生 fetch 没有超时，弱网或上游挂起时会把 UI 卡在「生成中」。
 */

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`请求超时（${ms}ms）`);
    this.name = 'TimeoutError';
  }
}

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) throw new TimeoutError(timeoutMs);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
