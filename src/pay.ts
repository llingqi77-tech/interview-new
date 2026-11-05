/**
 * 支付宝 AI 网页应用收款 —— 前端客户端
 *
 * 后端统一入口：/api/pay?action=...
 * 支付结果只认异步通知 / 主动查单，本模块不根据同步回跳判定成功。
 */

const API_BASE = '/api';

export interface PaySku {
  sku: string;
  subject: string;
  amount: string;
  description?: string;
}

export interface PayCatalog {
  alipay: {
    configured: boolean;
    appId: string | null;
    gateway: string | null;
    notifyUrl: string | null;
    returnUrl: string | null;
    sandbox: boolean;
  };
  database: boolean;
  skus: PaySku[];
}

export interface CreateOrderResult {
  out_trade_no: string;
  sku: string;
  subject: string;
  total_amount: string;
  /** 支付宝返回的自动提交表单 HTML，必须渲染并 submit，不能当 URL 跳转 */
  payment_html: string;
}

export interface PayOrder {
  id: number;
  out_trade_no: string;
  sku: string;
  subject: string;
  total_amount: string;
  status: 'CREATED' | 'PAID' | 'CLOSED' | 'REFUNDED' | 'PARTIAL_REFUNDED';
  trade_no: string | null;
  paid_at: string | null;
  refunded_amount: string;
  created_at: string;
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

/** 商品目录 + 支付是否已配置 */
export async function getPayCatalog(): Promise<PayCatalog | null> {
  const res = await fetch(`${API_BASE}/pay?action=catalog`);
  if (!res.ok) return null;
  return parseJson<PayCatalog>(res);
}

/** 下单：返回自动提交表单 HTML */
export async function createPayOrder(params: {
  sku: string;
  walletAddress?: string | null;
  sessionId?: number | null;
}): Promise<CreateOrderResult> {
  const res = await fetch(`${API_BASE}/pay?action=create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sku: params.sku,
      wallet_address: params.walletAddress ?? undefined,
      session_id: params.sessionId ?? undefined,
    }),
  });
  const data = await parseJson<CreateOrderResult & { error?: string; message?: string }>(res);
  if (!res.ok || !data?.payment_html) {
    throw new Error(data?.message || data?.error || `下单失败（HTTP ${res.status}）`);
  }
  return data;
}

/**
 * 把支付宝返回的表单 HTML 渲染到页面并自动提交。
 *
 * 为什么不能直接 window.location.href = payment_html：
 * page.pay 返回的是 <form> + 自动提交脚本，不是 URL；直接跳转只会看到一串参数。
 */
export function submitPaymentForm(paymentHtml: string): void {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.inset = '0';
  container.style.zIndex = '9999';
  container.style.background = '#fff';
  container.innerHTML = paymentHtml;
  document.body.appendChild(container);

  const form = container.querySelector('form');
  if (form) {
    form.submit();
    return;
  }
  // 兜底：HTML 里没有 form 说明后端返回异常，别把用户卡在白屏
  container.remove();
  throw new Error('支付表单解析失败，请重试');
}

/** 主动查单（异步通知丢失时的兜底） */
export async function queryPayOrder(outTradeNo: string): Promise<{
  local: PayOrder | null;
  remote: Record<string, unknown>;
} | null> {
  const res = await fetch(`${API_BASE}/pay?action=query&out_trade_no=${encodeURIComponent(outTradeNo)}`);
  if (!res.ok) return null;
  return parseJson(res);
}

/** 本地订单列表（按钱包地址） */
export async function listPayOrders(walletAddress: string, limit = 50): Promise<PayOrder[]> {
  const res = await fetch(
    `${API_BASE}/pay?action=orders&wallet_address=${encodeURIComponent(walletAddress)}&limit=${limit}`
  );
  if (!res.ok) return [];
  const data = await parseJson<{ orders: PayOrder[] }>(res);
  return data?.orders ?? [];
}

/**
 * 轮询等待订单变成 PAID。
 * 用户从支付宝跳回后调用；默认 20 次 × 3 秒 = 1 分钟。
 */
export async function waitForPaid(
  outTradeNo: string,
  options: { attempts?: number; intervalMs?: number } = {}
): Promise<PayOrder | null> {
  const attempts = options.attempts ?? 20;
  const intervalMs = options.intervalMs ?? 3000;
  for (let i = 0; i < attempts; i += 1) {
    const result = await queryPayOrder(outTradeNo);
    if (result?.local?.status === 'PAID') return result.local;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}
