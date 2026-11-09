import { createHash, randomBytes } from 'node:crypto';
import { callGateway, type AlipayConfig } from './alipay.ts';

/**
 * AI 按量付费（Machine Pay）—— 402 Payment Required 协议
 *
 * 协议依据：
 *   接入指南   https://aipay.alipay.com/docs/ai-receive/MACHINE_PAY.html
 *   预下单接口 https://aipay.alipay.com/docs/ai-receive/api-list/alipay-aipay-agent-payment-precreate.html
 *   凭证验证   https://aipay.alipay.com/docs/ai-receive/api-list/alipay-aipay-agent-payment-verify.html
 *
 * 时序：
 *   1. 智能体不带 Payment-Proof 请求资源
 *   2. 服务端调 precreate 拿 amt_pre_pay_id，返回 402 + amtPaymentLink 响应头
 *   3. 智能体把预下单号交给支付宝，用户确认付款
 *   4. 智能体带 Payment-Proof 再请求
 *   5. 服务端调 verify，active=true 且金额/订单号对得上才返回资源
 */

export const AGENT_ENV_KEYS = {
  serviceId: 'ALIPAY_AGENT_SERVICE_ID',
  price: 'ALIPAY_AGENT_PRICE',
  goodsName: 'ALIPAY_AGENT_GOODS_NAME',
} as const;

export interface AgentServiceConfig {
  /** 按量付费注册分配的服务 ID，形如 API_67A60134AB7A4BCE */
  serviceId: string;
  /** 单价（元，两位小数字符串），必须与注册时填的一致，否则用户无法支付 */
  price: string;
  /** 账单展示的商品名 */
  goodsName: string;
}

export function readAgentServiceConfig(): AgentServiceConfig | null {
  const serviceId = (process.env[AGENT_ENV_KEYS.serviceId] ?? '').trim();
  const rawPrice = (process.env[AGENT_ENV_KEYS.price] ?? '').trim();
  const goodsName = (process.env[AGENT_ENV_KEYS.goodsName] ?? '').trim() || 'AI 群面模拟';

  if (!serviceId || !rawPrice) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(rawPrice)) return null;

  const value = Number(rawPrice);
  // 支付宝限制：0.01 ≤ 单价 ≤ 50
  if (!(value >= 0.01 && value <= 50)) return null;

  return { serviceId, price: value.toFixed(2), goodsName };
}

/** 规范化 JSON：键排序、无空白，保证同一语义请求得到同一哈希 */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(',')}}`;
}

/** 请求体指纹：同一请求重试复用同一订单，避免重复扣费 */
export function hashRequest(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

/** 商户订单号：AG + 时间戳36进制 + 12位随机，≤32 字符 */
export function newAgentOutTradeNo(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = randomBytes(6).toString('hex').toUpperCase();
  return `AG${stamp}${random}`;
}

/** 支付截止时间：ISO8601 带 +08:00，支付宝要求不超过当前时间 12 小时 */
export function payBeforeISO(hours = 2, now: Date = new Date()): string {
  const target = new Date(now.getTime() + hours * 3600_000 + 8 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}` +
    `T${pad(target.getUTCHours())}:${pad(target.getUTCMinutes())}:${pad(target.getUTCSeconds())}+08:00`
  );
}

export interface PaymentProof {
  paymentProof: string;
  tradeNo: string;
  clientSession?: string;
}

/**
 * 解析 Payment-Proof 请求头。
 * 原文是 base64(JSON)：
 *   { "protocol": { "payment_proof": "...", "trade_no": "..." },
 *     "method":   { "client_session": "..." } }
 */
export function parsePaymentProof(raw: string | undefined | null): PaymentProof | null {
  if (!raw || !raw.trim()) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(raw.trim(), 'base64').toString('utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }

  const obj = parsed as {
    protocol?: { payment_proof?: unknown; trade_no?: unknown };
    method?: { client_session?: unknown };
  };

  const paymentProof = typeof obj?.protocol?.payment_proof === 'string' ? obj.protocol.payment_proof : '';
  const tradeNo = typeof obj?.protocol?.trade_no === 'string' ? obj.protocol.trade_no : '';
  if (!paymentProof || !tradeNo) return null;

  const clientSession =
    typeof obj?.method?.client_session === 'string' && obj.method.client_session
      ? obj.method.client_session
      : undefined;

  return { paymentProof, tradeNo, ...(clientSession ? { clientSession } : {}) };
}

export interface PrecreateResult {
  amtPrePayId: string;
  payBefore: string;
  code: string;
  subCode?: string;
  subMsg?: string;
}

export async function precreate(
  alipay: AlipayConfig,
  config: AgentServiceConfig,
  outTradeNo: string
): Promise<PrecreateResult> {
  const payBefore = payBeforeISO(2);
  const response = await callGateway(alipay, 'alipay.aipay.agent.payment.precreate', {
    pay_before: payBefore,
    amount: config.price,
    goods_name: config.goodsName,
    service_id: config.serviceId,
    out_trade_no: outTradeNo,
    currency: 'CNY',
    memo: config.goodsName,
  });

  return {
    amtPrePayId: typeof response.amt_pre_pay_id === 'string' ? response.amt_pre_pay_id : '',
    payBefore,
    code: typeof response.code === 'string' ? response.code : '',
    ...(typeof response.sub_code === 'string' ? { subCode: response.sub_code } : {}),
    ...(typeof response.sub_msg === 'string' ? { subMsg: response.sub_msg } : {}),
  };
}

export interface VerifyResult {
  active: boolean;
  amount: string;
  outTradeNo: string;
  tradeNo: string;
  code: string;
  subCode?: string;
  subMsg?: string;
}

export async function verifyProof(alipay: AlipayConfig, proof: PaymentProof): Promise<VerifyResult> {
  const response = await callGateway(alipay, 'alipay.aipay.agent.payment.verify', {
    trade_no: proof.tradeNo,
    payment_proof: proof.paymentProof,
    ...(proof.clientSession ? { client_session: proof.clientSession } : {}),
  });

  return {
    active: response.active === true,
    amount: typeof response.amount === 'string' ? response.amount : '',
    outTradeNo: typeof response.out_trade_no === 'string' ? response.out_trade_no : '',
    tradeNo: typeof response.trade_no === 'string' ? response.trade_no : '',
    code: typeof response.code === 'string' ? response.code : '',
    ...(typeof response.sub_code === 'string' ? { subCode: response.sub_code } : {}),
    ...(typeof response.sub_msg === 'string' ? { subMsg: response.sub_msg } : {}),
  };
}
