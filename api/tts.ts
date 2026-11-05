import type { VercelRequest, VercelResponse } from '@vercel/node';
import { issueToken, isStepFunConfigured, STEPFUN_CONFIG } from './_lib/stepfun.ts';
import { createSseWriter, pipeUpstreamSse } from './_lib/sse.ts';
import { getClientIp, isTokenRoute } from './_lib/http.ts';
import { checkRateLimit } from './_lib/ratelimit.ts';

/**
 * /api/tts —— StepFun TTS 服务端代理（PRD 4.1.5 / G.4 / C9）
 * 前端不持 key：本端注入 STEPFUN_API_KEY 调 /v1/audio/speech（stream_format=sse），
 * 音频分片（PCM 24kHz s16le base64）经 SSE 透传。
 * 文档：https://platform.stepfun.com/docs/zh/api-reference/audio/create-audio
 */

const STEP_TTS_URL = 'https://api.stepfun.com/v1/audio/speech';


export default async function handler(request: VercelRequest, response: VercelResponse) {
  // /api/tts-token 兼容路由（原独立函数已并入本文件，见 vercel.json rewrite）
  if (isTokenRoute(request, 'tts')) {
    if (request.method !== 'POST') {
      return response.status(405).json({ error: 'Method not allowed' });
    }
    if (!isStepFunConfigured()) {
      return response.status(503).json({
        error: 'STEPFUN_NOT_CONFIGURED',
        message: '服务端未配置 STEPFUN_API_KEY，语音合成不可用，将降级为文字/浏览器语音',
        fallback: 'webspeech',
      });
    }
    const voiceId = typeof request.body?.voice_id === 'string' ? request.body.voice_id : undefined;
    const issued = issueToken('tts', voiceId ? { voice_id: voiceId } : {});
    return response.status(200).json({
      ...issued,
      endpoint: STEPFUN_CONFIG.tts.endpoint,
      model: STEPFUN_CONFIG.tts.model,
      fallback_models: [...STEPFUN_CONFIG.tts.fallbackModels],
      voice_id: voiceId ?? null,
    });
  }
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }
  if (!isStepFunConfigured()) {
    return response.status(503).json({
      error: 'STEPFUN_NOT_CONFIGURED',
      message: '服务端未配置 STEPFUN_API_KEY，语音合成不可用，将降级为浏览器语音/文字',
      fallback: 'webspeech-tts',
    });
  }

  const body = (request.body ?? {}) as {
    text?: string;
    voice_id?: string;
    rate?: number;
    instruction?: string;
    session_id?: number | null;
  };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const voiceId = typeof body.voice_id === 'string' ? body.voice_id.trim() : '';
  if (!text || !voiceId) {
    return response.status(400).json({ error: 'text 与 voice_id 必填' });
  }
  if (text.length > 1000) {
    return response.status(400).json({ error: 'text 超过 1000 字上限（stepaudio-3-tts）' });
  }

  const limit = checkRateLimit(getClientIp(request), body.session_id ?? null);
  if (!limit.allowed) {
    return response.status(429).json({ error: 'rate_limited', reason: limit.reason, retry_after_ms: limit.retryAfterMs });
  }

  const rate = typeof body.rate === 'number' && !Number.isNaN(body.rate) ? Math.min(2, Math.max(0.5, body.rate)) : 1;
  const instruction = typeof body.instruction === 'string' && body.instruction.trim() ? body.instruction.trim().slice(0, 500) : undefined;

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(STEP_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.STEPFUN_API_KEY!.trim()}`,
      },
      body: JSON.stringify({
        model: STEPFUN_CONFIG.tts.model,
        input: text,
        voice: voiceId,
        response_format: 'pcm',
        sample_rate: 24000,
        speed: rate,
        ...(instruction ? { instruction } : {}),
        stream_format: 'sse',
      }),
    });
  } catch (err) {
    return response.status(502).json({ error: 'TTS_UPSTREAM_UNREACHABLE', message: err instanceof Error ? err.message : String(err) });
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '');
    return response.status(502).json({ error: 'TTS_UPSTREAM_FAILED', message: errText || `HTTP ${upstream.status}` });
  }

  // SSE 透传：上游 speech.audio.delta/done/error → 客户端 delta/done/error
  const sse = createSseWriter(response);
  try {
    await pipeUpstreamSse(upstream.body, (payload) => {
      try {
        const data = JSON.parse(payload) as { type?: string; audio?: string; message?: string };
        if (data.type === 'speech.audio.delta' && typeof data.audio === 'string' && data.audio) {
          sse.send('delta', { audio: data.audio });
        } else if (data.type === 'speech.audio.done') {
          sse.send('done', {});
        } else if (data.type === 'speech.audio.error') {
          sse.send('error', { message: data.message ?? 'TTS 上游错误' });
        }
      } catch {
        // 忽略单条解析失败
      }
    });
  } catch (err) {
    sse.send('error', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    sse.close();
  }
}
