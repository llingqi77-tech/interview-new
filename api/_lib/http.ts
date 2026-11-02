import type { VercelRequest } from '@vercel/node';

/** 客户端 IP（限流用）：x-forwarded-for 首段 → socket 地址 */
export function getClientIp(req: VercelRequest): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  if (Array.isArray(fwd)) return fwd[0];
  return req.socket?.remoteAddress;
}

/**
 * 兼容路由判定：/api/asr-token 与 /api/tts-token 已并入 /api/asr、/api/tts
 * （Vercel Hobby 档 12 函数上限，支付通道要占一个位）。
 *
 * 两种环境都要认：
 *   - Vercel：vercel.json rewrite 把旧路径改写成 ?__route=token
 *   - 本地 dev / ECS（server/local-api.ts、server/prod-api.ts）：request.url 仍是原路径
 */
export function isTokenRoute(req: VercelRequest, kind: 'asr' | 'tts'): boolean {
  const route = req.query?.__route;
  if ((Array.isArray(route) ? route[0] : route) === 'token') return true;
  const url = req.url ?? '';
  return new RegExp(`/api/${kind}-token(?:[?#]|$)`).test(url);
}
