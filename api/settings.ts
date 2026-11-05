import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getClientIp } from './_lib/http.ts';
import {
  CONFIG_GROUPS,
  configFilePath,
  getConfigEntries,
  isRuntimeConfigWritable,
  saveRuntimeConfig,
} from './_lib/runtimeConfig.ts';

/**
 * /api/settings —— 服务端密钥配置（页面填写，不碰 .env.local）
 *
 * 为什么是一个文件：api/ 下每个 .ts 都是一个 Vercel 函数，Hobby 档上限 12 个。
 *
 * 路由：
 *   GET  /api/settings                      配置分组 + 每项状态（密钥只回显掩码）
 *   POST /api/settings                      保存 { values: { KEY: "..." } }，空串 = 清除
 *   POST /api/settings?action=test-llm      用当前配置探一次 LLM 端点（GET /models，不消耗 token）
 *
 * 写保护：
 *   - 配了 SETTINGS_ADMIN_TOKEN → 必须带 x-admin-token 头
 *   - 没配 → 只允许本机 / 内网地址
 *   - Vercel → 文件系统只读，写入返回 501
 * 读保护：未授权时只回 configured 布尔，不回显任何密钥片段。
 */

function actionOf(request: VercelRequest): string {
  const raw = request.query?.action;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === 'string' && value.trim()) return value.trim();
  const match = /[?&]action=([^&#]+)/.exec(request.url ?? '');
  return match ? decodeURIComponent(match[1]) : '';
}

function jsonBody(request: VercelRequest): Record<string, unknown> {
  const body = request.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    return body as Record<string, unknown>;
  }
  if (typeof body === 'string' && body.trim()) {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function isPrivateAddress(ip?: string): boolean {
  if (!ip) return false;
  const addr = ip.replace(/^::ffff:/i, '').trim();
  if (!addr) return false;
  if (addr === '127.0.0.1' || addr === '::1' || addr === 'localhost') return true;
  if (/^10\./.test(addr)) return true;
  if (/^192\.168\./.test(addr)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return true;
  // IPv6 ULA fc00::/7 与链路本地 fe80::/10
  if (/^f[cd][0-9a-f]{2}:/i.test(addr)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(addr)) return true;
  return false;
}

function adminToken(): string {
  return (process.env.SETTINGS_ADMIN_TOKEN ?? '').trim();
}

function providedToken(request: VercelRequest): string {
  const header = request.headers['x-admin-token'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' ? value.trim() : '';
}

function authorize(request: VercelRequest): { ok: boolean; reason?: string } {
  const expected = adminToken();
  if (expected) {
    return providedToken(request) === expected
      ? { ok: true }
      : { ok: false, reason: '令牌不正确（SETTINGS_ADMIN_TOKEN）' };
  }
  if (isPrivateAddress(getClientIp(request))) return { ok: true };
  return { ok: false, reason: '未设置 SETTINGS_ADMIN_TOKEN 时只允许本机 / 内网地址访问设置接口' };
}

/** 探活：GET {baseUrl}/models，只验证 key 与端点可达，不产生 token 消耗 */
async function testLlm(response: VercelResponse) {
  const key = (process.env.DEEPSEEK_API_KEY ?? '').trim();
  if (!key) {
    return response.status(200).json({ ok: false, error: 'DEEPSEEK_API_KEY 未配置' });
  }
  const baseUrl = ((process.env.DEEPSEEK_BASE_URL ?? '').trim() || 'https://api.deepseek.com/v1')
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '');
  const model = (process.env.DEEPSEEK_MODEL ?? '').trim() || 'deepseek-chat';
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    if (!res.ok) {
      return response.status(200).json({
        ok: false,
        status: res.status,
        latencyMs,
        baseUrl,
        model,
        error: text.slice(0, 300) || `HTTP ${res.status}`,
      });
    }
    let models: string[] = [];
    try {
      const parsed = JSON.parse(text) as { data?: { id?: string }[] };
      models = (parsed.data ?? []).map((item) => item.id ?? '').filter(Boolean);
    } catch {
      // 非 JSON 响应也算连通（部分网关 /models 返回纯文本）
    }
    return response.status(200).json({
      ok: true,
      status: res.status,
      latencyMs,
      baseUrl,
      model,
      modelAvailable: models.length === 0 ? null : models.includes(model),
      models: models.slice(0, 50),
    });
  } catch (error) {
    return response.status(200).json({
      ok: false,
      latencyMs: Date.now() - started,
      baseUrl,
      model,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const action = actionOf(request);
  const auth = authorize(request);
  const writable = isRuntimeConfigWritable();

  try {
    if (request.method === 'GET') {
      return response.status(200).json({
        writable: writable.writable,
        reason: writable.reason ?? null,
        authorized: auth.ok,
        authReason: auth.reason ?? null,
        tokenRequired: Boolean(adminToken()),
        configFile: writable.writable ? configFilePath() : null,
        groups: CONFIG_GROUPS,
        entries: getConfigEntries({ reveal: auth.ok }),
      });
    }

    if (request.method !== 'POST') {
      return response.status(405).json({ error: 'Method not allowed' });
    }

    if (!auth.ok) {
      return response.status(403).json({ error: 'FORBIDDEN', message: auth.reason });
    }
    if (!writable.writable) {
      return response.status(501).json({ error: 'READ_ONLY', message: writable.reason });
    }

    if (action === 'test-llm') {
      return await testLlm(response);
    }

    const body = jsonBody(request);
    const values = body.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return response.status(400).json({ error: 'BAD_REQUEST', message: 'body.values 必须是对象' });
    }

    const patch: Record<string, string> = {};
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (typeof value === 'string') patch[key] = value;
    }

    const result = await saveRuntimeConfig(patch);
    return response.status(200).json({
      ok: true,
      changed: result.changed,
      entries: getConfigEntries({ reveal: true }),
    });
  } catch (error) {
    console.error('[settings] %s %s error:', request.method, action || '(default)', error);
    return response.status(500).json({
      error: 'SETTINGS_ERROR',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
