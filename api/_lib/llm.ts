import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Context,
  type Model,
  type MutableModels,
  type TextContent,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';

/**
 * 统一 LLM 访问层（@earendil-works/pi-ai，PRD D1 修复 + 4.1.1）
 * 项目内所有 LLM 调用统一经 pi-ai 的 OpenAI 兼容 provider 发出；
 * API Key 只从 process.env.DEEPSEEK_API_KEY 读取，前端永不持有（C9）。
 * 端点 / 模型 / 温度可用 DEEPSEEK_BASE_URL / DEEPSEEK_MODEL / DEEPSEEK_TEMPERATURE 覆盖
 * （默认 DeepSeek 官方；任意 OpenAI 兼容端点均可，如 Kimi/Moonshot）。
 */

const PROVIDER_ID = 'unified-llm';
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';

function getApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || !key.trim()) {
    throw new Error('DEEPSEEK_API_KEY 未配置（服务端环境变量）');
  }
  return key.trim();
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim());
}

/** base URL：env 允许填到 .../chat/completions，统一归一化为 /v1 根（pi-ai 自行拼接端点路径） */
function getBaseUrl(): string {
  const raw = (process.env.DEEPSEEK_BASE_URL && process.env.DEEPSEEK_BASE_URL.trim()) || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

function getModelId(): string {
  return (process.env.DEEPSEEK_MODEL && process.env.DEEPSEEK_MODEL.trim()) || DEFAULT_MODEL;
}

/**
 * 按 action 的模型覆盖：DEEPSEEK_MODEL_<ACTION>（如 DEEPSEEK_MODEL_REPLY）
 * 优先于 DEEPSEEK_MODEL。用途：交互循环（reply）延迟敏感可用轻模型，
 * 一次性调用（topic/feedback/analyze）质量敏感用强模型。
 */
export function getModelIdFor(action?: string): string {
  if (action) {
    const override = process.env[`DEEPSEEK_MODEL_${action.toUpperCase()}`];
    if (override && override.trim()) return override.trim();
  }
  return getModelId();
}

/** 温度覆盖：部分模型（如 Kimi k2/k3）仅允许 temperature=1，用 DEEPSEEK_TEMPERATURE 强制统一值 */
function getTemperature(requested: number): number {
  const override = process.env.DEEPSEEK_TEMPERATURE;
  if (override && override.trim()) {
    const v = Number(override.trim());
    if (!Number.isNaN(v)) return v;
  }
  return requested;
}

/** max_tokens 覆盖：推理模型（如 kimi-k3）思考链可占数千 token，默认 8192 易被吃光导致正文为空 */
function getMaxTokens(): number {
  const v = process.env.DEEPSEEK_MAX_TOKENS;
  if (v && v.trim()) {
    const n = Number(v.trim());
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return 8192;
}

/**
 * 推理强度覆盖（DEEPSEEK_REASONING=low|medium|high）。
 * Kimi 等推理模型默认思考链极长（topic 生成 4min+ 且期间无可见输出），
 * 设 low 后约 15s；不设则按非推理模型处理（DeepSeek 官方行为不变）。
 */
function getReasoningLevel(): 'low' | 'medium' | 'high' | null {
  const v = process.env.DEEPSEEK_REASONING?.trim();
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  return null;
}

interface LlmRuntime {
  models: MutableModels;
  model: Model<'openai-completions'>;
}

const runtimeCache = new Map<string, LlmRuntime>();
/** 构建（并缓存）pi-ai Models 集合：单 provider + 单模型，配置完全来自 env */
function getRuntime(modelIdArg: string): LlmRuntime {
  const baseUrl = getBaseUrl();
  const modelId = modelIdArg;
  if (!runtimeCache.has(`${baseUrl}|${modelId}`)) {
    const reasoningLevel = getReasoningLevel();
    const modelDef: Model<'openai-completions'> = {
      id: modelId,
      name: modelId,
      api: 'openai-completions',
      provider: PROVIDER_ID,
      baseUrl,
      reasoning: reasoningLevel !== null,
      // pi-ai 对 Moonshot 默认不发 reasoning_effort（过于保守），显式打开
      ...(reasoningLevel ? { compat: { supportsReasoningEffort: true } } : {}),
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 256000,
      maxTokens: getMaxTokens(),
    };
    const provider = createProvider({
      id: PROVIDER_ID,
      name: 'Unified LLM (pi-ai)',
      baseUrl,
      auth: { apiKey: envApiKeyAuth('LLM API key', ['DEEPSEEK_API_KEY']) },
      models: [modelDef],
      api: openAICompletionsApi(),
    });
    const models = createModels();
    models.setProvider(provider);
    const model = models.getModel(PROVIDER_ID, modelId) as Model<'openai-completions'> | undefined;
    if (!model) {
      throw new Error(`pi-ai 模型注册失败: ${PROVIDER_ID}/${modelId}`);
    }
    runtimeCache.set(`${baseUrl}|${modelId}`, { models, model });
  }
  return runtimeCache.get(`${baseUrl}|${modelId}`)!;
}

function userContext(prompt: string): Context {
  return { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] };
}

function toError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`LLM API 请求失败: ${msg}`);
}

/** 非流式调用 */
export async function callDeepSeek(prompt: string, temperature = 0.7, action?: string): Promise<string> {
  getApiKey(); // 未配置时快速报错
  const { models, model } = getRuntime(getModelIdFor(action));
  let msg;
  try {
    msg = await models.completeSimple(model, userContext(prompt), {
      temperature: getTemperature(temperature),
      ...(getReasoningLevel() ? { reasoning: getReasoningLevel()! } : {}),
    });
  } catch (err) {
    throw toError(err);
  }
  if (msg.errorMessage || msg.stopReason === 'error' || msg.stopReason === 'aborted') {
    throw toError(msg.errorMessage ?? `stopReason=${msg.stopReason}`);
  }
  const content = msg.content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!content) {
    throw new Error(`LLM API 响应格式异常，未找到生成内容（stopReason=${msg.stopReason}，可能 max_tokens 被推理链占满）`);
  }
  return content;
}

/**
 * 流式调用，逐段回调。
 * @param onDelta 每收到一段文本
 * @param signal 中断信号（barge-in / 客户端断开）
 */
export async function callDeepSeekStream(
  prompt: string,
  temperature: number,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
  action?: string
): Promise<string> {
  getApiKey();
  const { models, model } = getRuntime(getModelIdFor(action));
  let full = '';
  try {
    const stream = models.streamSimple(model, userContext(prompt), {
      temperature: getTemperature(temperature),
      ...(getReasoningLevel() ? { reasoning: getReasoningLevel()! } : {}),
      signal,
    });
    for await (const ev of stream) {
      if (ev.type === 'text_delta') {
        full += ev.delta;
        onDelta(ev.delta);
      } else if (ev.type === 'error') {
        throw new Error(ev.error.errorMessage ?? `stopReason=${ev.reason}`);
      }
    }
  } catch (err) {
    throw toError(err);
  }
  return full;
}

/** 运行时配置变更后清空 provider 缓存（key / baseUrl / model 都可能变） */
export function resetLlmRuntimeCache(): void {
  runtimeCache.clear();
}
