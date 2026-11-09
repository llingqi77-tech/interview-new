import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool, isDatabaseConfigured } from './db.ts';
import { getClientIp } from './http.ts';
import { checkRateLimit } from './ratelimit.ts';
import { isAlipayConfigured, readAlipayConfig } from './alipay.ts';
import {
  hashRequest,
  newAgentOutTradeNo,
  parsePaymentProof,
  precreate,
  readAgentServiceConfig,
  verifyProof,
} from './agentPay.ts';
import {
  createAgentOrder,
  findOrderByOutTradeNo,
  findOrderResult,
  findReusableAgentOrder,
  markPaidIdempotent,
  saveOrderResult,
} from './payStore.ts';
import { callDeepSeek, isLlmConfigured } from './llm.ts';
import { safeJsonParse } from './jsonStream.ts';

/**
 * AI 群面模拟 —— AI 按量付费（Machine Pay）业务实现
 *
 * 对外路径：POST /api/agent/interview
 *   Vercel 走 vercel.json rewrite → /api/pay?action=agent-interview
 *   本地 dev / ECS 走路由表 → api/pay.ts，由 actionOf() 按 URL 识别
 *
 * 为什么放在 _lib 而不是独立 api 文件：api/ 下每个 .ts 都是一个 Vercel 函数，
 * Hobby 档上限 12 个，仓库已顶格。支付相关的全部动作共用 api/pay.ts 一个函数位。
 *
 * 支付宝服务 ID：ALIPAY_AGENT_SERVICE_ID（注册后分配，形如 API_67A60134AB7A4BCE）
 * 单价：ALIPAY_AGENT_PRICE，必须与注册时填的一致，否则用户无法支付
 *
 * 协议：
 *   无 Payment-Proof → 402 + amtPaymentLink 响应头（预下单号）
 *   有 Payment-Proof → 调 verify，active=true 且金额/订单号对得上才返回内容
 *
 * 幂等：
 *   - 同一请求体 30 分钟内复用同一笔未支付订单（智能体重试不重复扣费）
 *   - 已交付的结果存 result_json，同一凭证重复调用直接回放，不重复烧 LLM
 */

const SKU = 'agent_interview';
const MAX_ROLES = 5;
const ALLOWED_FORMATS = new Set(['lgd', 'panel']);
const ALLOWED_DURATIONS = new Set([15, 25, 40]);

interface InterviewRequest {
  job_title: string;
  company: string;
  topic?: string;
  format?: 'lgd' | 'panel';
  roles?: string[];
  duration_minutes?: number;
}

function jsonBody(request: VercelRequest): Record<string, unknown> {
  const body = request.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body as Record<string, unknown>;
  if (typeof body === 'string' && body.trim()) {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function headerValue(request: VercelRequest, name: string): string | undefined {
  const raw = request.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === 'string' ? raw : undefined;
}

/** 校验并归一化请求体；返回 null 表示非法 */
function normalizeRequest(body: Record<string, unknown>): InterviewRequest | null {
  const jobTitle = typeof body.job_title === 'string' ? body.job_title.trim() : '';
  const company = typeof body.company === 'string' ? body.company.trim() : '';
  if (!jobTitle || jobTitle.length > 64) return null;
  if (!company || company.length > 64) return null;

  const topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, 200) : '';
  const format = typeof body.format === 'string' && ALLOWED_FORMATS.has(body.format) ? body.format : 'lgd';

  const roles = Array.isArray(body.roles)
    ? body.roles.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).slice(0, MAX_ROLES)
    : [];

  const rawDuration = typeof body.duration_minutes === 'number' ? body.duration_minutes : 25;
  const duration = ALLOWED_DURATIONS.has(rawDuration) ? rawDuration : 25;

  return {
    job_title: jobTitle,
    company,
    ...(topic ? { topic } : {}),
    format: format as 'lgd' | 'panel',
    ...(roles.length > 0 ? { roles } : {}),
    duration_minutes: duration,
  };
}

function buildPrompt(input: InterviewRequest): string {
  const formatHint =
    input.format === 'panel'
      ? 'panel 阵型：2-3 位面试官轮流提问，候选人（用户视角）作答'
      : 'lgd 阵型：1 位主持人 + 3 位候选人，围绕同一题目做无领导小组讨论';

  return `你是群面（无领导小组讨论）模拟器。根据下面的参数生成一场完整的模拟群面，并给出示范性评估报告。

参数：
- 目标岗位：${input.job_title}
- 目标公司：${input.company}
- 讨论题目：${input.topic || '由你根据岗位和公司拟定一个贴合真实业务、有争议空间的题目'}
- 阵型：${formatHint}
- 指定角色：${input.roles && input.roles.length > 0 ? input.roles.join('、') : '由你按岗位自动配置'}
- 时长：${input.duration_minutes} 分钟

要求：
1. 题目要贴合目标岗位和公司的真实业务场景，能考察结构化思维、协作与影响力。
2. 每位候选人发言 2-3 轮，风格必须区分明显（有人抢话定框架、有人提数据、有人做总结收口）。
3. 评估报告针对「候选人整体表现」给出示范性评分，并说明什么样的发言能拿高分。

只输出 JSON，不要任何解释、不要 markdown 代码块。结构严格如下：
{
  "topic": "讨论题目",
  "roles": [{"id": "角色标识", "name": "角色名", "stance": "一句话立场"}],
  "transcript": [{"round": 1, "speaker": "角色名", "content": "发言内容"}],
  "report": {
    "overall_score": 0到100的整数,
    "dimensions": [{"name": "维度名", "score": 0到100的整数, "evidence": "原文证据", "advice": "改进建议"}],
    "highlights": ["亮点"],
    "improvements": ["改进点"]
  }
}`;
}

export async function handleAgentInterview(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  // ---- 配置检查 ----
  if (!isAlipayConfigured()) {
    return response.status(503).json({
      error: 'ALIPAY_NOT_CONFIGURED',
      message: '服务端未配置 ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY',
    });
  }
  const agentConfig = readAgentServiceConfig();
  if (!agentConfig) {
    return response.status(503).json({
      error: 'AGENT_SERVICE_NOT_CONFIGURED',
      message: '服务端未配置 ALIPAY_AGENT_SERVICE_ID / ALIPAY_AGENT_PRICE（按量付费服务注册后分配）',
    });
  }
  if (!isDatabaseConfigured()) {
    return response.status(503).json({ error: 'DATABASE_NOT_CONFIGURED', message: '服务端未配置 DATABASE_URL' });
  }
  if (!isLlmConfigured()) {
    return response.status(503).json({ error: 'LLM_NOT_CONFIGURED', message: '服务端未配置 DEEPSEEK_API_KEY' });
  }

  const alipay = readAlipayConfig()!;
  const pool = getPool();

  try {
    // ---- 请求校验 ----
    const input = normalizeRequest(jsonBody(request));
    if (!input) {
      return response.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'job_title 与 company 必填（各 ≤64 字符）；format 取 lgd|panel；duration_minutes 取 15|25|40',
      });
    }

    const requestHash = hashRequest(input);
    const proof = parsePaymentProof(headerValue(request, 'payment-proof'));

    // ---- 未带凭证：预下单 + 402 ----
    if (!proof) {
      const limit = checkRateLimit(getClientIp(request));
      if (!limit.allowed) {
        return response
          .status(429)
          .json({ error: 'rate_limited', reason: limit.reason, retry_after_ms: limit.retryAfterMs });
      }

      // 同一请求 30 分钟内复用未支付订单，避免智能体重试产生第二笔
      const reusable = await findReusableAgentOrder(pool, requestHash, 30);
      const outTradeNo = reusable?.out_trade_no ?? newAgentOutTradeNo();

      if (!reusable) {
        await createAgentOrder(pool, {
          outTradeNo,
          requestHash,
          sku: SKU,
          subject: agentConfig.goodsName,
          totalAmount: agentConfig.price,
        });
      }

      const pre = await precreate(alipay, agentConfig, outTradeNo);
      if (!pre.amtPrePayId) {
        return response.status(502).json({
          error: 'PRECREATE_FAILED',
          message: pre.subMsg || pre.subCode || '支付宝预下单失败',
          code: pre.code,
        });
      }

      response.setHeader('amtPaymentLink', pre.amtPrePayId);
      return response.status(402).json({
        error: 'PAYMENT_REQUIRED',
        message: '该资源需要先支付，请用 amtPaymentLink 完成付款后携带 Payment-Proof 重试',
        amount: agentConfig.price,
        currency: 'CNY',
        goods_name: agentConfig.goodsName,
        out_trade_no: outTradeNo,
        pay_before: pre.payBefore,
        amt_payment_link: pre.amtPrePayId,
      });
    }

    // ---- 带凭证：验证 ----
    const verified = await verifyProof(alipay, proof);
    if (!verified.active) {
      return response.status(402).json({
        error: 'PAYMENT_INVALID',
        message: verified.subMsg || '支付凭证无效或已过期，请重新支付',
        code: verified.code,
      });
    }

    // 金额必须与注册单价一致
    if (Number(verified.amount) !== Number(agentConfig.price)) {
      return response.status(402).json({
        error: 'AMOUNT_MISMATCH',
        message: `凭证金额 ${verified.amount} 与服务单价 ${agentConfig.price} 不一致`,
      });
    }

    // 凭证必须对应「本次请求」的订单，防止拿便宜订单的凭证换贵资源
    const order = await findOrderByOutTradeNo(pool, verified.outTradeNo);
    if (!order) {
      return response.status(402).json({ error: 'ORDER_NOT_FOUND', message: '凭证对应的订单不存在' });
    }
    if (order.request_hash !== requestHash) {
      return response.status(402).json({
        error: 'ORDER_REQUEST_MISMATCH',
        message: '该支付凭证不是为本次请求创建的订单，请重新下单',
      });
    }

    // ---- 已交付过：直接回放，不重复烧 LLM ----
    const cached = await findOrderResult(pool, verified.outTradeNo);
    if (cached) {
      return response.status(200).json({
        service: agentConfig.goodsName,
        out_trade_no: verified.outTradeNo,
        trade_no: verified.tradeNo,
        amount: agentConfig.price,
        cached: true,
        result: cached,
      });
    }

    // ---- 首次交付：跑模拟 ----
    await markPaidIdempotent(pool, {
      outTradeNo: verified.outTradeNo,
      tradeNo: verified.tradeNo,
      appId: alipay.appId,
      rawParams: { source: 'machine_pay', amount: verified.amount },
    });

    const raw = await callDeepSeek(buildPrompt(input), 0.7, 'analyze');
    const result = safeJsonParse<Record<string, unknown>>(raw);
    if (!result) {
      return response.status(502).json({
        error: 'GENERATION_FAILED',
        message: '模型返回内容不是合法 JSON，请重试（本次已支付，重试不会重复扣费）',
      });
    }

    await saveOrderResult(pool, verified.outTradeNo, result);

    return response.status(200).json({
      service: agentConfig.goodsName,
      out_trade_no: verified.outTradeNo,
      trade_no: verified.tradeNo,
      amount: agentConfig.price,
      cached: false,
      result,
    });
  } catch (error) {
    console.error('/api/agent/interview error:', error);
    return response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
