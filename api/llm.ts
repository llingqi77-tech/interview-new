import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit } from './_lib/ratelimit.ts';
import { isLlmConfigured } from './_lib/llm.ts';
import { getClientIp } from './_lib/http.ts';
import { dispatchLlmAction, readPayload } from './_lib/llmRoute.ts';

/**
 * /api/llm —— DeepSeek 代理（PRD 4.1.1 / E.2）
 * action: topic | reply | feedback | analyze
 * 具体动作在 _lib/llmRoute.ts。这里只做方法、参数、限流和配置门控。
 */

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const body = request.body as { action?: unknown; payload?: unknown; stream?: boolean; session_id?: number | null } | null;
  if (!body || typeof body.action !== 'string') {
    return response.status(400).json({ error: '缺少 action 字段' });
  }
  const payload = readPayload(body.payload);
  if (!payload) {
    return response.status(400).json({ error: '缺少 payload 字段' });
  }

  const limit = checkRateLimit(getClientIp(request), body.session_id ?? null);
  if (!limit.allowed) {
    return response.status(429).json({
      error: 'rate_limited',
      reason: limit.reason,
      retry_after_ms: limit.retryAfterMs,
    });
  }

  if (!isLlmConfigured()) {
    return response.status(500).json({ error: 'LLM_NOT_CONFIGURED', message: '服务端未配置 DEEPSEEK_API_KEY' });
  }

  try {
    await dispatchLlmAction(response, body.action, payload, body.stream);
  } catch (err) {
    console.error('/api/llm error:', err);
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('DEEPSEEK_API_KEY') ? 500 : 502;
    return response.status(status).json({ error: 'LLM_CALL_FAILED', message });
  }
}
