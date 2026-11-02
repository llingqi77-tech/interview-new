import { createSign, createVerify } from 'node:crypto';

/**
 * 支付宝开放平台网关协议（RSA2）—— 零依赖实现
 *
 * 为什么不用 alipay-sdk：本机 pnpm store 版本错配（node_modules 由 pnpm 12 装，
 * store 为 v11；本机 pnpm 10/11/12 均只认 v10），`pnpm add` 一律
 * ERR_PNPM_UNEXPECTED_STORE。网关协议本身很小，用 node:crypto 直接实现，
 * 少一个运行时依赖，也少一条供应链面。
 *
 * 协议依据：
 *   公共请求参数 https://aipay.alipay.com/docs/vibe-pay/ai-web-app-payment-qianyi/api-list/alipay-trade-page-pay.html
 *   异步通知验签 https://aipay.alipay.com/docs/vibe-pay/ai-web-app-payment-qianyi/api-list/async-notify-verify.html
 *
 * 签名规则（请求）：
 *   1. 取全部请求参数（公共参数 + biz_content），去掉 sign
 *   2. 去掉空值（undefined / null / ''）
 *   3. 按参数名 ASCII 升序排序
 *   4. 拼成 k1=v1&k2=v2（值不做 URL 编码）
 *   5. SHA256withRSA（RSA2）签名，base64
 *
 * 验签规则（异步通知）：
 *   1. 去掉 sign 与 sign_type
 *   2. 值取 URLDecode 之后的明文
 *   3. 其余同上
 */

export type AlipaySignType = 'RSA2' | 'RSA';

export interface AlipayConfig {
  appId: string;
  /** 应用私钥（PEM） */
  privateKeyPem: string;
  /** 支付宝公钥（PEM） */
  alipayPublicKeyPem: string;
  gateway: string;
  notifyUrl: string;
  returnUrl: string;
  /** 可选：校验异步通知的收款方（seller_id 或 seller_email 任一命中即可） */
  sellerId?: string;
  sellerEmail?: string;
  signType: AlipaySignType;
}

export const ALIPAY_PROD_GATEWAY = 'https://openapi.alipay.com/gateway.do';
export const ALIPAY_SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';

/** 环境变量名（.env.example 与 docs/alipay-aipay.md 必须与此一致） */
export const ALIPAY_ENV_KEYS = {
  appId: 'ALIPAY_APP_ID',
  privateKey: 'ALIPAY_PRIVATE_KEY',
  publicKey: 'ALIPAY_PUBLIC_KEY',
  gateway: 'ALIPAY_GATEWAY',
  notifyUrl: 'ALIPAY_NOTIFY_URL',
  returnUrl: 'ALIPAY_RETURN_URL',
  sellerId: 'ALIPAY_SELLER_ID',
  sellerEmail: 'ALIPAY_SELLER_EMAIL',
  keyType: 'ALIPAY_KEY_TYPE',
  signType: 'ALIPAY_SIGN_TYPE',
} as const;

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

/**
 * 把环境变量里的密钥还原成 PEM。
 * 支持三种写法：
 *   1. 完整 PEM（含 -----BEGIN ...-----），换行可用字面量 \n
 *   2. 纯 base64 单行（支付宝密钥工具导出的形态）
 *   3. 带空格的 base64（复制粘贴时被折行）
 */
export function toPem(raw: string, kind: 'private' | 'public', keyType: 'PKCS1' | 'PKCS8' = 'PKCS1'): string {
  const text = raw.trim();
  if (!text) throw new Error('密钥为空');

  if (text.includes('-----BEGIN')) {
    // 环境变量里常写成一行，把字面量 \n 还原成真换行
    return text.replace(/\\n/g, '\n');
  }

  const body = text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(body)) {
    throw new Error('密钥不是合法 base64，请检查是否复制完整');
  }
  const lines = body.match(/.{1,64}/g)?.join('\n') ?? body;

  if (kind === 'public') {
    return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`;
  }
  const label = keyType === 'PKCS8' ? 'PRIVATE KEY' : 'RSA PRIVATE KEY';
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

/** 读取并校验配置；缺项返回 null（调用方据此返回 503，不阻断应用其它功能） */
export function readAlipayConfig(): AlipayConfig | null {
  const appId = env(ALIPAY_ENV_KEYS.appId);
  const privateKeyRaw = env(ALIPAY_ENV_KEYS.privateKey);
  const publicKeyRaw = env(ALIPAY_ENV_KEYS.publicKey);
  if (!appId || !privateKeyRaw || !publicKeyRaw) return null;

  const keyType = env(ALIPAY_ENV_KEYS.keyType).toUpperCase() === 'PKCS8' ? 'PKCS8' : 'PKCS1';
  const signType = env(ALIPAY_ENV_KEYS.signType).toUpperCase() === 'RSA' ? 'RSA' : 'RSA2';

  return {
    appId,
    privateKeyPem: toPem(privateKeyRaw, 'private', keyType),
    alipayPublicKeyPem: toPem(publicKeyRaw, 'public'),
    gateway: env(ALIPAY_ENV_KEYS.gateway) || ALIPAY_PROD_GATEWAY,
    notifyUrl: env(ALIPAY_ENV_KEYS.notifyUrl),
    returnUrl: env(ALIPAY_ENV_KEYS.returnUrl),
    sellerId: env(ALIPAY_ENV_KEYS.sellerId) || undefined,
    sellerEmail: env(ALIPAY_ENV_KEYS.sellerEmail) || undefined,
    signType,
  };
}

export function isAlipayConfigured(): boolean {
  try {
    return readAlipayConfig() !== null;
  } catch {
    return false;
  }
}

/** 对前端可见的配置摘要（不含任何密钥） */
export function getAlipayPublicConfig() {
  const config = readAlipayConfig();
  if (!config) {
    return {
      configured: false,
      appId: null,
      gateway: null,
      notifyUrl: null,
      returnUrl: null,
      sandbox: false,
    };
  }
  return {
    configured: true,
    appId: config.appId,
    gateway: config.gateway,
    notifyUrl: config.notifyUrl || null,
    returnUrl: config.returnUrl || null,
    sandbox: config.gateway.includes('alipaydev.com'),
  };
}

/**
 * 待签名字符串。
 * @param exclude 需要剔除的参数名（请求签名剔 sign；通知验签剔 sign + sign_type）
 */
export function buildSignContent(params: Record<string, unknown>, exclude: string[] = ['sign']): string {
  const skip = new Set(exclude);
  return Object.keys(params)
    .filter((key) => {
      if (skip.has(key)) return false;
      const value = params[key];
      if (value === undefined || value === null) return false;
      return String(value) !== '';
    })
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join('&');
}

function algorithm(signType: AlipaySignType): string {
  return signType === 'RSA' ? 'RSA-SHA1' : 'RSA-SHA256';
}

/** 请求签名：返回 base64 签名串 */
export function signParams(
  params: Record<string, unknown>,
  privateKeyPem: string,
  signType: AlipaySignType = 'RSA2'
): string {
  const content = buildSignContent(params, ['sign']);
  return createSign(algorithm(signType)).update(content, 'utf8').sign(privateKeyPem, 'base64');
}

/** 异步通知验签：params 必须是 URLDecode 之后的明文值 */
export function verifyNotifySign(
  params: Record<string, unknown>,
  alipayPublicKeyPem: string,
  signType: AlipaySignType = 'RSA2'
): boolean {
  const sign = typeof params.sign === 'string' ? params.sign : '';
  if (!sign) return false;
  const content = buildSignContent(params, ['sign', 'sign_type']);
  try {
    return createVerify(algorithm(signType))
      .update(content, 'utf8')
      .verify(alipayPublicKeyPem, sign, 'base64');
  } catch {
    return false;
  }
}

/** 支付宝要求的 timestamp 格式：yyyy-MM-dd HH:mm:ss（北京时间，禁止 ISO） */
export function alipayTimestamp(now: Date = new Date()): string {
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${beijing.getUTCFullYear()}-${pad(beijing.getUTCMonth() + 1)}-${pad(beijing.getUTCDate())} ` +
    `${pad(beijing.getUTCHours())}:${pad(beijing.getUTCMinutes())}:${pad(beijing.getUTCSeconds())}`
  );
}

/** 金额归一：返回「元」为单位、两位小数的字符串；非法返回 null。禁止浮点比较。 */
export function normalizeAmount(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return `${BigInt(match[1]).toString()}.${(match[2] ?? '').padEnd(2, '0')}`;
}

export function amountEquals(a: unknown, b: unknown): boolean {
  const left = normalizeAmount(a);
  const right = normalizeAmount(b);
  return left !== null && left === right;
}

export interface PagePayInput {
  outTradeNo: string;
  totalAmount: string;
  subject: string;
  body?: string;
  /** 透传参数，原样回到异步通知（支付宝要求先 URLEncode） */
  passbackParams?: string;
  /** 订单绝对超时时间 yyyy-MM-dd HH:mm:ss，可选 */
  timeExpire?: string;
}

/**
 * 生成 alipay.trade.page.pay 的自动提交表单 HTML。
 *
 * 注意：page.pay 是「页面跳转类」接口，返回的是 form HTML，
 * 前端必须渲染并 submit，不能拿 URL 直接跳转（否则页面只显示参数）。
 */
export function buildPagePayForm(config: AlipayConfig, input: PagePayInput): string {
  const bizContent: Record<string, unknown> = {
    out_trade_no: input.outTradeNo,
    total_amount: input.totalAmount,
    subject: input.subject,
    product_code: 'FAST_INSTANT_TRADE_PAY',
  };
  if (input.body) bizContent.body = input.body;
  if (input.passbackParams) bizContent.passback_params = encodeURIComponent(input.passbackParams);
  if (input.timeExpire) bizContent.time_expire = input.timeExpire;

  const params: Record<string, string> = {
    app_id: config.appId,
    method: 'alipay.trade.page.pay',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: config.signType,
    timestamp: alipayTimestamp(),
    version: '1.0',
    biz_content: JSON.stringify(bizContent),
  };
  if (config.notifyUrl) params.notify_url = config.notifyUrl;
  if (config.returnUrl) params.return_url = config.returnUrl;

  params.sign = signParams(params, config.privateKeyPem, config.signType);

  const fields = Object.entries(params)
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`
    )
    .join('\n');

  return [
    `<form id="alipay-page-pay" name="punchout_form" method="post" action="${escapeHtml(config.gateway)}?charset=utf-8">`,
    fields,
    '<input type="submit" value="立即支付" style="display:none">',
    '</form>',
    '<script>document.forms[0].submit();</script>',
  ].join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 调用系统类接口（alipay.trade.query / refund / close）。
 * 与 page.pay 不同，这些接口直接 POST 到网关并返回 JSON。
 */
export async function callGateway(
  config: AlipayConfig,
  method: string,
  bizContent: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {
    app_id: config.appId,
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: config.signType,
    timestamp: alipayTimestamp(),
    version: '1.0',
    biz_content: JSON.stringify(bizContent),
  };
  params.sign = signParams(params, config.privateKeyPem, config.signType);

  const response = await fetch(config.gateway, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params).toString(),
  });

  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`支付宝网关返回非 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`);
  }

  // 响应体形如 { "alipay_trade_query_response": {...}, "sign": "..." }
  const key = `${method.replace(/\./g, '_')}_response`;
  const body = (payload[key] ?? payload.error_response ?? payload) as Record<string, unknown>;
  return body;
}
