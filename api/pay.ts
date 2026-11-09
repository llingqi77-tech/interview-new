import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool, isDatabaseConfigured } from './_lib/db.ts';
import { getClientIp } from './_lib/http.ts';
import { checkRateLimit } from './_lib/ratelimit.ts';
import {
  amountEquals,
  buildPagePayForm,
  callGateway,
  getAlipayPublicConfig,
  isAlipayConfigured,
  normalizeAmount,
  readAlipayConfig,
  verifyNotifySign,
} from './_lib/alipay.ts';
import { findSku, getCatalog } from './_lib/payCatalog.ts';
import {
  applyRefund,
  createOrder,
  findOrderByOutTradeNo,
  listOrdersByWallet,
  markPaidIdempotent,
  newOutTradeNo,
  recordNotifyEvent,
  recordTradeStatus,
} from './_lib/payStore.ts';
import { handleAgentInterview } from './_lib/agentInterview.ts';

/**
 * /api/pay —— 支付宝 AI 网页应用收款（Vibe Pay 基础收款能力）统一入口
 *
 * 为什么是一个文件：api/ 下每个 .ts 都是一个 Vercel 函数，Hobby 档上限 12 个，
 * 本仓库已顶格。支付的全部动作按 ?action= 分发，只占一个函数位。
 *
 * 路由：
 *   GET  /api/pay?action=catalog                       商品目录 + 配置状态
 *   POST /api/pay?action=create                        下单，返回自动提交表单 HTML
 *   POST /api/pay?action=notify                        支付宝异步通知（form-urlencoded）
 *   GET  /api/pay?action=return                        同步回跳结果页（不判定成功）
 *   GET  /api/pay?action=query&out_trade_no=xxx        主动查单（本地 + 支付宝）
 *   POST /api/pay?action=refund                        退款（需 ALIPAY_ADMIN_TOKEN）
 *   POST /api/pay?action=close                         关闭交易（需 ALIPAY_ADMIN_TOKEN）
 *   GET  /api/pay?action=orders&wallet_address=0x...   本地订单列表
 *
 * 支付结果判定：只认异步通知验签 + 主动查单，绝不信任同步回跳参数。
 */

const PAID_STATUSES = new Set(['TRADE_SUCCESS', 'TRADE_FINISHED']);

function queryString(request: VercelRequest, key: string): string {
  const value = request.query?.[key];
  if (Array.isArray(value)) return value[0] ?? '';
  return typeof value === 'string' ? value : '';
}

function actionOf(request: VercelRequest): string {
  const explicit = queryString(request, 'action');
  if (explicit) return explicit;
  // /api/agent/interview 在 Vercel 走 rewrite 带 ?action=agent-interview；
  // 本地 dev / ECS 直连时 URL 仍是原路径，这里兜底识别
  if (/\/api\/agent\/interview(?:[?#]|$)/.test(request.url ?? '')) return 'agent-interview';
  return 'catalog';
}

/** 支付宝异步通知是 application/x-www-form-urlencoded；Vercel 可能已解析成对象，也可能给原始串 */
function parseFormBody(body: unknown): Record<string, string> {
  if (typeof body === 'string') {
    const out: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(body)) out[key] = value;
    return out;
  }
  if (body && typeof body === 'object') {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      out[key] = Array.isArray(value) ? String(value[0]) : String(value);
    }
    return out;
  }
  return {};
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

function requireAdmin(request: VercelRequest): boolean {
  const expected = (process.env.ALIPAY_ADMIN_TOKEN ?? '').trim();
  if (!expected) return false;
  const header = request.headers['x-admin-token'];
  const provided = Array.isArray(header) ? header[0] : header;
  return typeof provided === 'string' && provided === expected;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const action = actionOf(request);

  try {
    // ---------- AI 按量付费（Machine Pay）：AI 群面模拟 ----------
    if (action === 'agent-interview') {
      return await handleAgentInterview(request, response);
    }

    // ---------- 商品目录（前端渲染购买弹窗用） ----------
    if (action === 'catalog') {
      if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
      return response.status(200).json({
        alipay: getAlipayPublicConfig(),
        database: isDatabaseConfigured(),
        skus: getCatalog(),
      });
    }

    // ---------- 异步通知（唯一可信的支付结果来源之一） ----------
    if (action === 'notify') {
      return await handleNotify(request, response);
    }

    // ---------- 同步回跳（只做展示，不判定成功） ----------
    if (action === 'return') {
      return await handleReturn(request, response);
    }

    // 以下动作都需要支付宝配置
    if (!isAlipayConfigured()) {
      return response.status(503).json({
        error: 'ALIPAY_NOT_CONFIGURED',
        message: '服务端未配置 ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY，支付不可用',
      });
    }
    const config = readAlipayConfig()!;

    // ---------- 下单 ----------
    if (action === 'create') {
      if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });
      if (!isDatabaseConfigured()) {
        return response.status(503).json({ error: 'DATABASE_NOT_CONFIGURED', message: '服务端未配置 DATABASE_URL' });
      }

      const limit = checkRateLimit(getClientIp(request));
      if (!limit.allowed) {
        return response
          .status(429)
          .json({ error: 'rate_limited', reason: limit.reason, retry_after_ms: limit.retryAfterMs });
      }

      const body = jsonBody(request);
      const skuId = typeof body.sku === 'string' ? body.sku : '';
      const sku = findSku(skuId);
      if (!sku) {
        return response.status(400).json({ error: 'SKU_NOT_FOUND', message: `未知商品：${skuId || '(空)'}` });
      }

      const walletAddress =
        typeof body.wallet_address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(body.wallet_address)
          ? body.wallet_address.toLowerCase()
          : null;
      const sessionId =
        typeof body.session_id === 'number' && Number.isFinite(body.session_id) ? body.session_id : null;

      const outTradeNo = newOutTradeNo();
      const pool = getPool();
      await createOrder(pool, {
        outTradeNo,
        sku: sku.sku,
        subject: sku.subject,
        totalAmount: sku.amount,
        walletAddress,
        sessionId,
      });

      const paymentHtml = buildPagePayForm(config, {
        outTradeNo,
        totalAmount: sku.amount,
        subject: sku.subject,
        body: sku.description,
        passbackParams: walletAddress ? JSON.stringify({ w: walletAddress }) : undefined,
      });

      return response.status(200).json({
        out_trade_no: outTradeNo,
        sku: sku.sku,
        subject: sku.subject,
        total_amount: sku.amount,
        payment_html: paymentHtml,
      });
    }

    // ---------- 主动查单 ----------
    if (action === 'query') {
      if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
      const outTradeNo = queryString(request, 'out_trade_no');
      if (!outTradeNo) return response.status(400).json({ error: 'out_trade_no 必填' });

      const local = isDatabaseConfigured() ? await findOrderByOutTradeNo(getPool(), outTradeNo) : null;
      const remote = await callGateway(config, 'alipay.trade.query', { out_trade_no: outTradeNo });

      // 查单结果同样可以推进本地状态（异步通知丢失时的兜底）
      if (isDatabaseConfigured() && remote.code === '10000') {
        const tradeStatus = String(remote.trade_status ?? '');
        const pool = getPool();
        if (PAID_STATUSES.has(tradeStatus) && !remote.out_biz_no && !remote.gmt_refund) {
          await markPaidIdempotent(pool, {
            outTradeNo,
            tradeNo: String(remote.trade_no ?? ''),
            appId: config.appId,
            sellerId: typeof remote.seller_id === 'string' ? remote.seller_id : null,
            buyerId: typeof remote.buyer_id === 'string' ? remote.buyer_id : null,
            buyerOpenId: typeof remote.buyer_open_id === 'string' ? remote.buyer_open_id : null,
            rawParams: remote,
          });
        } else if (tradeStatus) {
          await recordTradeStatus(pool, outTradeNo, tradeStatus, remote);
        }
      }

      return response.status(200).json({ local, remote });
    }

    // ---------- 退款 ----------
    if (action === 'refund') {
      if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });
      if (!requireAdmin(request)) {
        return response.status(403).json({
          error: 'ADMIN_TOKEN_REQUIRED',
          message: '退款需要 ALIPAY_ADMIN_TOKEN，并在请求头带 x-admin-token',
        });
      }
      if (!isDatabaseConfigured()) {
        return response.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
      }

      const body = jsonBody(request);
      const outTradeNo = typeof body.out_trade_no === 'string' ? body.out_trade_no : '';
      if (!outTradeNo) return response.status(400).json({ error: 'out_trade_no 必填' });

      const pool = getPool();
      const order = await findOrderByOutTradeNo(pool, outTradeNo);
      if (!order) return response.status(404).json({ error: 'ORDER_NOT_FOUND' });
      if (order.status !== 'PAID' && order.status !== 'PARTIAL_REFUNDED') {
        return response.status(409).json({ error: 'ORDER_NOT_REFUNDABLE', status: order.status });
      }

      const remaining = normalizeAmount(
        (Number(order.total_amount) - Number(order.refunded_amount)).toFixed(2)
      );
      const requested =
        typeof body.refund_amount === 'string' || typeof body.refund_amount === 'number'
          ? normalizeAmount(body.refund_amount)
          : remaining;
      if (!requested) return response.status(400).json({ error: 'refund_amount 非法' });
      if (Number(requested) <= 0) return response.status(400).json({ error: 'refund_amount 必须大于 0' });
      if (Number(requested) > Number(remaining!)) {
        return response.status(400).json({ error: 'REFUND_EXCEEDS_REMAINING', remaining });
      }

      const outRequestNo =
        typeof body.out_request_no === 'string' && body.out_request_no
          ? body.out_request_no
          : `${outTradeNo}R${Date.now()}`;

      const remote = await callGateway(config, 'alipay.trade.refund', {
        out_trade_no: outTradeNo,
        refund_amount: requested,
        out_request_no: outRequestNo,
      });

      if (remote.code === '10000') {
        await applyRefund(pool, outTradeNo, requested);
      }

      return response.status(remote.code === '10000' ? 200 : 502).json({ remote, refund_amount: requested });
    }

    // ---------- 关闭交易 ----------
    if (action === 'close') {
      if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });
      if (!requireAdmin(request)) {
        return response.status(403).json({
          error: 'ADMIN_TOKEN_REQUIRED',
          message: '关单需要 ALIPAY_ADMIN_TOKEN，并在请求头带 x-admin-token',
        });
      }

      const body = jsonBody(request);
      const outTradeNo = typeof body.out_trade_no === 'string' ? body.out_trade_no : '';
      if (!outTradeNo) return response.status(400).json({ error: 'out_trade_no 必填' });

      const remote = await callGateway(config, 'alipay.trade.close', { out_trade_no: outTradeNo });
      if (remote.code === '10000' && isDatabaseConfigured()) {
        await recordTradeStatus(getPool(), outTradeNo, 'TRADE_CLOSED', remote);
      }
      return response.status(remote.code === '10000' ? 200 : 502).json({ remote });
    }

    // ---------- 本地订单列表 ----------
    if (action === 'orders') {
      if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
      if (!isDatabaseConfigured()) return response.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
      const wallet = queryString(request, 'wallet_address');
      if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
        return response.status(400).json({ error: 'wallet_address 必填（0x + 40 位十六进制）' });
      }
      const limit = Number(queryString(request, 'limit') || 50);
      return response.status(200).json({
        orders: await listOrdersByWallet(getPool(), wallet, Number.isFinite(limit) ? limit : 50),
      });
    }

    return response.status(404).json({ error: 'UNKNOWN_ACTION', action });
  } catch (error) {
    console.error(`/api/pay?action=${action} error:`, error);
    return response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 异步通知处理。
 * 顺序固定：验签 → 业务校验 → 去重 → 状态迁移 → 回 success。
 * 任何一步失败都回纯文本 fail，支付宝会按 4m/10m/10m/1h/2h/6h/15h 重试。
 */
async function handleNotify(request: VercelRequest, response: VercelResponse) {
  const params = parseFormBody(request.body);
  const fail = (reason: string) => {
    const { sign, ...safe } = params;
    console.warn('[alipay notify] fail:', reason, safe);
    return response.status(200).setHeader('Content-Type', 'text/plain; charset=utf-8').send('fail');
  };

  if (request.method !== 'POST') return fail('method not post');

  const config = readAlipayConfig();
  if (!config) return fail('alipay not configured');
  if (!isDatabaseConfigured()) return fail('database not configured');

  // 1. 验签
  const signType = params.sign_type === 'RSA' ? 'RSA' : 'RSA2';
  if (!verifyNotifySign(params, config.alipayPublicKeyPem, signType)) {
    return fail('signature check failed');
  }

  // 2. 业务校验：app_id / out_trade_no / total_amount / 收款方
  if (params.app_id !== config.appId) return fail('app_id mismatch');

  const outTradeNo = params.out_trade_no ?? '';
  if (!outTradeNo) return fail('out_trade_no missing');

  const pool = getPool();
  const order = await findOrderByOutTradeNo(pool, outTradeNo);
  if (!order) return fail('order not found');

  if (!amountEquals(order.total_amount, params.total_amount)) {
    return fail(`amount mismatch: order=${order.total_amount} notify=${params.total_amount}`);
  }

  if (config.sellerId || config.sellerEmail) {
    const sellerOk =
      (config.sellerId && params.seller_id === config.sellerId) ||
      (config.sellerEmail && params.seller_email === config.sellerEmail);
    if (!sellerOk) return fail('seller mismatch');
  }

  // 3. 去重（支付宝重试时 notify_id 不变）
  const notifyId = params.notify_id ?? '';
  if (!notifyId) return fail('notify_id missing');

  const firstTime = await recordNotifyEvent(pool, {
    notifyId,
    outTradeNo,
    tradeNo: params.trade_no ?? null,
    tradeStatus: params.trade_status ?? null,
    rawParams: params,
  });
  if (!firstTime) {
    // 重复通知：已经处理过，直接回 success 让支付宝停止重试
    return response.status(200).setHeader('Content-Type', 'text/plain; charset=utf-8').send('success');
  }

  // 4. 状态迁移
  const tradeStatus = params.trade_status ?? '';
  const isRefundEvent = Boolean(params.out_biz_no || params.gmt_refund || params.refund_fee);

  if (PAID_STATUSES.has(tradeStatus) && !isRefundEvent) {
    await markPaidIdempotent(pool, {
      outTradeNo,
      tradeNo: params.trade_no ?? '',
      appId: params.app_id,
      sellerId: params.seller_id ?? null,
      buyerId: params.buyer_id ?? null,
      buyerOpenId: params.buyer_open_id ?? null,
      rawParams: params,
    });
    // 发货钩子：这里接你的权益发放（加次数 / 开会员 / 写 entitlement 表）
    // 幂等由 markPaidIdempotent 的返回值保证，重复通知不会重复发货。
  } else {
    await recordTradeStatus(pool, outTradeNo, tradeStatus, params);
  }

  return response.status(200).setHeader('Content-Type', 'text/plain; charset=utf-8').send('success');
}

/**
 * 同步回跳结果页。
 * 支付宝 GET 回跳带的参数不可信（可被伪造），这里只按 out_trade_no 查本地库展示，
 * 真正的支付结果以异步通知 / 主动查单为准。
 */
async function handleReturn(request: VercelRequest, response: VercelResponse) {
  const outTradeNo = queryString(request, 'out_trade_no');
  let status = 'UNKNOWN';
  let subject = '';
  let amount = '';

  if (outTradeNo && isDatabaseConfigured()) {
    const order = await findOrderByOutTradeNo(getPool(), outTradeNo);
    if (order) {
      status = order.status;
      subject = order.subject;
      amount = order.total_amount;
    }
  }

  const paid = status === 'PAID' || status === 'REFUNDED' || status === 'PARTIAL_REFUNDED';
  const title = paid ? '支付成功' : status === 'CLOSED' ? '订单已关闭' : '支付结果确认中';
  const hint = paid
    ? '权益已到账，可以关闭本页返回应用。'
    : '如果刚刚完成付款，请稍等几秒后刷新；支付结果以支付宝异步通知为准。';

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
       background:#0b0d12;color:#e8eaed}
  .card{max-width:420px;padding:32px;border-radius:16px;background:#151922;border:1px solid #232936;text-align:center}
  h1{font-size:20px;margin:0 0 12px}
  p{font-size:14px;line-height:1.7;color:#9aa4b2;margin:0 0 8px}
  .amt{font-size:28px;font-weight:600;color:#e8eaed;margin:16px 0}
  .meta{font-size:12px;color:#5f6b7d;margin-top:20px;word-break:break-all}
  a{display:inline-block;margin-top:20px;padding:10px 20px;border-radius:10px;background:#1677ff;color:#fff;
    text-decoration:none;font-size:14px}
</style></head>
<body><div class="card">
  <h1>${escapeHtml(title)}</h1>
  ${amount ? `<div class="amt">¥${escapeHtml(amount)}</div>` : ''}
  ${subject ? `<p>${escapeHtml(subject)}</p>` : ''}
  <p>${escapeHtml(hint)}</p>
  <div class="meta">订单号：${escapeHtml(outTradeNo || '(缺失)')}<br>状态：${escapeHtml(status)}</div>
  <a href="/">返回应用</a>
</div></body></html>`;

  return response.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
}
