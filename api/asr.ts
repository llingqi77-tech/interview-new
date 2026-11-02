import type { VercelRequest, VercelResponse } from '@vercel/node';
import { issueToken, isStepFunConfigured, STEPFUN_CONFIG } from './_lib/stepfun.ts';
import { createSseWriter, pipeUpstreamSse } from './_lib/sse.ts';
import { checkRateLimit } from './_lib/ratelimit.ts';
import { getClientIp, isTokenRoute } from './_lib/http.ts';

/**
 * /api/asr —— StepFun ASR 服务端代理（PRD 4.1.6 / G.2 / C9）
 * 前端提交 base64 音频，本端注入 STEPFUN_API_KEY 调 /v1/audio/asr/sse（JSON + SSE），
 * 增量/最终转写经 SSE 透传。
 * 文档：https://platform.stepfun.com/docs/zh/api-reference/audio/asr-sse
 */

const STEP_ASR_URL = 'https://api.stepfun.com/v1/audio/asr/sse';
const MAX_AUDIO_BASE64_CHARS = 14_000_000; // ≈10MB 音频，防滥用


interface AsrFormat {
  type?: string;
  codec?: string;
  rate?: number;
  bits?: number;
  channel?: number;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  // /api/asr-token 兼容路由（原独立函数已并入本文件，见 vercel.json rewrite）
  if (isTokenRoute(request, 'asr')) {
    if (request.method !== 'POST') {
      return response.status(405).json({ error: 'Method not allowed' });
    }
    if (!isStepFunConfigured()) {
      return response.status(503).json({
        error: 'STEPFUN_NOT_CONFIGURED',
        message: '服务端未配置 STEPFUN_API_KEY，语音识别不可用，将降级为浏览器语音/手动输入',
        fallback: 'webspeech',
      });
    }
    const issued = issueToken('asr');
    return response.status(200).json({
      ...issued,
      endpoint: STEPFUN_CONFIG.asr.endpoint,
      model: STEPFUN_CONFIG.asr.model,
    });
  }
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }
  if (!isStepFunConfigured()) {
    return response.status(503).json({
      error: 'STEPFUN_NOT_CONFIGURED',
      message: '服务端未配置 STEPFUN_API_KEY，语音识别不可用，将降级为浏览器语音/文字',
      fallback: 'webspeech',
    });
  }

  const body = (request.body ?? {}) as {
    audio?: string;
    format?: AsrFormat;
    language?: string;
    hotwords?: string[];
    session_id?: number | null;
  };
  const audio = typeof body.audio === 'string' ? body.audio : '';
  if (!audio) {
    return response.status(400).json({ error: 'audio（base64）必填' });
  }
  if (audio.length > MAX_AUDIO_BASE64_CHARS) {
    return response.status(413).json({ error: '音频过大（上限约 10MB）' });
  }

  const limit = checkRateLimit(getClientIp(request), body.session_id ?? null);
  if (!limit.allowed) {
    return response.status(429).json({ error: 'rate_limited', reason: limit.reason, retry_after_ms: limit.retryAfterMs });
  }

  // format 白名单透传（pcm 时 rate/bits/channel 必填由上游校验）
  const fmt: AsrFormat = {};
  if (body.format && typeof body.format === 'object') {
    for (const k of ['type', 'codec', 'rate', 'bits', 'channel'] as const) {
      const v = body.format[k];
      if (v !== undefined && v !== null) (fmt as Record<string, unknown>)[k] = v;
    }
  }

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(STEP_ASR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${process.env.STEPFUN_API_KEY!.trim()}`,
      },
      body: JSON.stringify({
        audio: {
          data: audio,
          input: {
            transcription: {
              language: typeof body.language === 'string' ? body.language : 'zh',
              model: STEPFUN_CONFIG.asr.model,
              enable_itn: true,
              ...(Array.isArray(body.hotwords) && body.hotwords.length > 0 ? { hotwords: body.hotwords.slice(0, 20).map(String) } : {}),
            },
            format: fmt,
          },
        },
      }),
    });
  } catch (err) {
    return response.status(502).json({ error: 'ASR_UPSTREAM_UNREACHABLE', message: err instanceof Error ? err.message : String(err) });
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '');
    return response.status(502).json({ error: 'ASR_UPSTREAM_FAILED', message: errText || `HTTP ${upstream.status}` });
  }

  // SSE 透传：transcript.text.delta → delta；transcript.text.done → done；其余 error
  const sse = createSseWriter(response);
  try {
    await pipeUpstreamSse(upstream.body, (payload) => {
      try {
        const data = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          text?: string;
          start_time?: number;
          end_time?: number;
          message?: string;
        };
        if (data.type === 'transcript.text.delta' && typeof data.delta === 'string') {
          sse.send('delta', { delta: data.delta, start_time: data.start_time ?? null, end_time: data.end_time ?? null });
        } else if (data.type === 'transcript.text.done') {
          sse.send('done', { text: typeof data.text === 'string' ? data.text : '' });
        } else if (data.type && data.type.includes('error')) {
          sse.send('error', { message: data.message ?? 'ASR 上游错误' });
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
