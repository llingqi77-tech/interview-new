import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 运行时配置覆盖层（设置页填写 key → 落盘 → 覆盖 process.env）
 *
 * 为什么是覆盖 process.env 而不是改读取点：
 * 全仓 20+ 处 handler 都直接读 process.env.X（llm / stepfun / db / alipay / payCatalog）。
 * 与其逐个改成 getEnv()，不如在启动时和保存时把页面填的值写进 process.env —— 读取方零改动，
 * 也不会漏掉任何一处（漏一处就是"页面填了但某个功能还是 503"）。
 *
 * 优先级：页面配置 > .env.local / 系统环境变量 > 代码默认值
 * 清空某个 key（提交空串）→ 回落到 .env.local 的值，而不是把环境变量删掉。
 *
 * 落盘：<cwd>/.runtime-config.json（0600，已 gitignore）
 * Vercel：函数文件系统只读，设置页只读展示，写入返回 501。
 */

export interface ConfigField {
  key: string;
  label: string;
  hint?: string;
  /** true = 密钥类，状态里只回显掩码；false = 普通配置，回显原值 */
  secret?: boolean;
  placeholder?: string;
}

export interface ConfigGroup {
  id: string;
  title: string;
  description: string;
  fields: ConfigField[];
}

export const CONFIG_GROUPS: ConfigGroup[] = [
  {
    id: 'llm',
    title: 'LLM 文本',
    description: '所有 LLM 调用经服务端代理发出，key 只存在服务端，前端 bundle 永不持有。',
    fields: [
      {
        key: 'DEEPSEEK_API_KEY',
        label: 'API Key',
        secret: true,
        hint: 'Moonshot / DeepSeek / 任意 OpenAI 兼容端点的 key',
      },
      { key: 'DEEPSEEK_BASE_URL', label: 'Base URL', placeholder: 'https://api.moonshot.cn/v1' },
      { key: 'DEEPSEEK_MODEL', label: '模型', placeholder: 'kimi-k3' },
      { key: 'DEEPSEEK_TEMPERATURE', label: 'temperature', placeholder: '1（Kimi 只接受 1）' },
      { key: 'DEEPSEEK_MAX_TOKENS', label: 'max_tokens', placeholder: '32768' },
      { key: 'DEEPSEEK_REASONING', label: 'reasoning', placeholder: 'low | medium | high' },
    ],
  },
  {
    id: 'voice',
    title: '语音（StepFun）',
    description: 'TTS / ASR 凭证签发。未配置时前端自动降级 Web Speech / 纯文字。',
    fields: [{ key: 'STEPFUN_API_KEY', label: 'API Key', secret: true }],
  },
  {
    id: 'db',
    title: '数据库',
    description: 'PostgreSQL 连接串。未配置时会话、支付落库、事件流全部 503，前端降级本地模式。',
    fields: [
      {
        key: 'DATABASE_URL',
        label: '连接串',
        secret: true,
        placeholder: 'postgresql://user:pass@host:5432/interview_db?sslmode=require',
      },
      { key: 'DB_POOL_MAX', label: '连接池上限', placeholder: '3（serverless）/ 10（ECS）' },
    ],
  },
  {
    id: 'alipay',
    title: '支付宝',
    description: 'AI 网页应用收款。APP_ID / 应用私钥 / 支付宝公钥三项齐全才算配置完成。',
    fields: [
      { key: 'ALIPAY_APP_ID', label: 'APP_ID' },
      { key: 'ALIPAY_PRIVATE_KEY', label: '应用私钥', secret: true, hint: '完整 PEM 或纯 base64 单行都行' },
      { key: 'ALIPAY_PUBLIC_KEY', label: '支付宝公钥', secret: true },
      { key: 'ALIPAY_GATEWAY', label: '网关', placeholder: 'https://openapi.alipay.com/gateway.do' },
      {
        key: 'ALIPAY_NOTIFY_URL',
        label: '异步通知地址',
        placeholder: 'https://your.domain/api/pay?action=notify',
      },
      {
        key: 'ALIPAY_RETURN_URL',
        label: '同步回跳地址',
        placeholder: 'https://your.domain/api/pay?action=return',
      },
      { key: 'ALIPAY_KEY_TYPE', label: '密钥格式', placeholder: 'PKCS1 | PKCS8' },
      { key: 'ALIPAY_SIGN_TYPE', label: '签名算法', placeholder: 'RSA2 | RSA' },
      { key: 'ALIPAY_SELLER_ID', label: '卖家 ID' },
      { key: 'ALIPAY_SELLER_EMAIL', label: '卖家邮箱' },
      { key: 'ALIPAY_ADMIN_TOKEN', label: '管理令牌', secret: true, hint: '退款 / 关单接口的 x-admin-token' },
    ],
  },
  {
    id: 'security',
    title: '安全',
    description: '设置页写保护。留空时只允许本机 / 内网地址写入。',
    fields: [
      {
        key: 'SETTINGS_ADMIN_TOKEN',
        label: '设置页令牌',
        secret: true,
        hint: '设置后，保存配置必须带这个令牌（页面会提示输入）',
      },
    ],
  },
];

export const CONFIG_KEYS: string[] = CONFIG_GROUPS.flatMap((group) => group.fields.map((field) => field.key));
const KEY_SET = new Set(CONFIG_KEYS);

export type ConfigSource = 'runtime' | 'env' | 'none';

export interface ConfigEntryStatus {
  key: string;
  configured: boolean;
  source: ConfigSource;
  /** 未授权时恒为 null（不回显任何片段） */
  preview: string | null;
}

/** 启动时的基线环境（.env.local / 系统变量），清空页面配置时回落到这里 */
let baseEnv: Record<string, string | undefined> | null = null;

export function configFilePath(): string {
  const custom = (process.env.RUNTIME_CONFIG_FILE ?? '').trim();
  return custom || path.join(process.cwd(), '.runtime-config.json');
}

function readConfigFile(): Record<string, string> {
  const file = configFilePath();
  if (!existsSync(file)) return {};
  try {
    const raw = readFileSync(file, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!KEY_SET.has(key)) continue;
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch (error) {
    console.error('[runtimeConfig] 读取失败，按空配置处理：', error);
    return {};
  }
}

function writeConfigFile(data: Record<string, string>): void {
  const file = configFilePath();
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows 上 chmod 语义有限，忽略
  }
}

function snapshotBaseEnv(): void {
  if (baseEnv) return;
  baseEnv = {};
  for (const key of CONFIG_KEYS) baseEnv[key] = process.env[key];
}

function applyValue(key: string, value: string): void {
  const base = baseEnv?.[key];
  if (value === '') {
    if (base === undefined) delete process.env[key];
    else process.env[key] = base;
    return;
  }
  process.env[key] = value;
}

/**
 * 启动时调用一次：先给基线环境拍快照，再把 .runtime-config.json 覆盖上去。
 * 必须在 .env.local 加载之后调用（server/local-api.ts、server/prod-api.ts）。
 */
export function loadRuntimeConfigSync(): void {
  snapshotBaseEnv();
  const file = readConfigFile();
  for (const [key, value] of Object.entries(file)) applyValue(key, value);
}

export function isRuntimeConfigWritable(): { writable: boolean; reason?: string } {
  if (process.env.VERCEL) {
    return {
      writable: false,
      reason: 'Vercel 函数文件系统只读，请在项目 Settings → Environment Variables 配置后重新部署',
    };
  }
  return { writable: true };
}

export function maskValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 10) return '••••••';
  return `${trimmed.slice(0, 4)}••••••${trimmed.slice(-4)}`;
}

export function getConfigEntries(options: { reveal: boolean }): Record<string, ConfigEntryStatus> {
  const file = readConfigFile();
  const out: Record<string, ConfigEntryStatus> = {};
  for (const group of CONFIG_GROUPS) {
    for (const field of group.fields) {
      const runtimeValue = file[field.key];
      const hasRuntime = runtimeValue !== undefined && runtimeValue !== '';
      const effective = hasRuntime ? runtimeValue : (process.env[field.key] ?? '');
      const configured = Boolean(effective && effective.trim());
      const source: ConfigSource = hasRuntime ? 'runtime' : configured ? 'env' : 'none';
      out[field.key] = {
        key: field.key,
        configured,
        source,
        preview: options.reveal && configured ? (field.secret ? maskValue(effective) : effective) : null,
      };
    }
  }
  return out;
}

/** 配置变更后清掉依赖它的进程内缓存（LLM provider、PG 连接池） */
async function invalidateCaches(changed: string[]): Promise<void> {
  if (changed.some((key) => key.startsWith('DEEPSEEK_'))) {
    try {
      const mod = await import('./llm.ts');
      mod.resetLlmRuntimeCache();
    } catch (error) {
      console.error('[runtimeConfig] 清理 LLM 缓存失败：', error);
    }
  }
  if (changed.some((key) => key === 'DATABASE_URL' || key === 'POSTGRES_URL' || key === 'DB_POOL_MAX')) {
    try {
      const mod = await import('./db.ts');
      await mod.resetPool();
    } catch (error) {
      console.error('[runtimeConfig] 重建数据库连接池失败：', error);
    }
  }
}

export interface SaveResult {
  changed: string[];
}

/**
 * 合并写入：只处理白名单内的 key，空串表示"清除页面配置、回落到环境变量"。
 * 写盘成功后才改 process.env，避免内存与磁盘不一致。
 */
export async function saveRuntimeConfig(patch: Record<string, string>): Promise<SaveResult> {
  const writable = isRuntimeConfigWritable();
  if (!writable.writable) throw new Error(writable.reason ?? '当前环境不可写');

  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!KEY_SET.has(key)) continue;
    clean[key] = typeof value === 'string' ? value.trim() : '';
  }
  if (Object.keys(clean).length === 0) return { changed: [] };

  const current = readConfigFile();
  const next: Record<string, string> = { ...current };
  const changed: string[] = [];
  for (const [key, value] of Object.entries(clean)) {
    const before = current[key] ?? '';
    if (before === value) continue;
    changed.push(key);
    if (value === '') delete next[key];
    else next[key] = value;
  }
  if (changed.length === 0) return { changed: [] };

  writeConfigFile(next);
  snapshotBaseEnv();
  for (const key of changed) applyValue(key, clean[key]);
  await invalidateCaches(changed);
  return { changed };
}
