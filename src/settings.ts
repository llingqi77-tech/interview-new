/**
 * 服务端密钥配置 —— 前端客户端
 *
 * 后端统一入口：/api/settings
 * 密钥永不回传明文：未授权时连掩码都不给，只回 configured 布尔。
 */

const API_BASE = '/api';

export interface SettingsField {
  key: string;
  label: string;
  hint?: string;
  secret?: boolean;
  placeholder?: string;
}

export interface SettingsGroup {
  id: string;
  title: string;
  description: string;
  fields: SettingsField[];
}

export type ConfigSource = 'runtime' | 'env' | 'none';

export interface SettingsEntry {
  key: string;
  configured: boolean;
  source: ConfigSource;
  preview: string | null;
}

export interface SettingsSnapshot {
  writable: boolean;
  reason: string | null;
  authorized: boolean;
  authReason: string | null;
  tokenRequired: boolean;
  configFile: string | null;
  groups: SettingsGroup[];
  entries: Record<string, SettingsEntry>;
}

export interface SaveSettingsResult {
  ok: boolean;
  changed: string[];
  entries: Record<string, SettingsEntry>;
}

export interface LlmProbeResult {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  baseUrl?: string;
  model?: string;
  modelAvailable?: boolean | null;
  models?: string[];
  error?: string;
}

async function parseJson<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { 'x-admin-token': token } : {};
}

export async function getSettings(token?: string): Promise<SettingsSnapshot | null> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'GET',
    headers: authHeaders(token),
    cache: 'no-store',
  });
  return parseJson<SettingsSnapshot>(res);
}

export async function saveSettings(
  values: Record<string, string>,
  token?: string
): Promise<SaveSettingsResult> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ values }),
  });
  const data = await parseJson<SaveSettingsResult & { message?: string; error?: string }>(res);
  if (!res.ok || !data) {
    throw new Error(data?.message ?? data?.error ?? `保存失败（HTTP ${res.status}）`);
  }
  return data;
}

export async function testLlm(token?: string): Promise<LlmProbeResult> {
  const res = await fetch(`${API_BASE}/settings?action=test-llm`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  const data = await parseJson<LlmProbeResult & { message?: string }>(res);
  if (!data) throw new Error(`探活失败（HTTP ${res.status}）`);
  return data;
}
