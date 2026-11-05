import type { Pool } from 'pg';

/**
 * 支付订单持久化（支付宝 AI 网页应用收款）
 *
 * 两张表：
 *   pay_orders          —— 一笔商户订单一行，out_trade_no 唯一
 *   pay_notify_events   —— 异步通知去重表，notify_id 唯一（支付宝重试时 notify_id 不变）
 *
 * 幂等策略：
 *   1. notify_id 唯一约束挡住重复通知
 *   2. markPaidIdempotent 用 `WHERE status <> 'PAID'` 做条件更新，天然幂等
 *   3. 金额/商户号/收款方在业务层二次校验，不信任通知里的值
 *
 * 表结构同时写在 db/migration-v0.9-pay.sql；ensurePaySchema 会在首次使用时
 * 幂等建表，省掉手工跑 SQL 这一步（DDL 与迁移文件必须保持一致）。
 */

export type PayOrderStatus = 'CREATED' | 'PAID' | 'CLOSED' | 'REFUNDED' | 'PARTIAL_REFUNDED';

export interface PayOrder {
  id: number;
  out_trade_no: string;
  sku: string;
  subject: string;
  total_amount: string;
  status: PayOrderStatus;
  trade_no: string | null;
  buyer_id: string | null;
  buyer_open_id: string | null;
  app_id: string | null;
  seller_id: string | null;
  wallet_address: string | null;
  session_id: number | null;
  paid_at: string | null;
  closed_at: string | null;
  refunded_amount: string;
  created_at: string;
  updated_at: string;
}

const DDL = `
CREATE TABLE IF NOT EXISTS pay_orders (
  id               BIGSERIAL PRIMARY KEY,
  out_trade_no     VARCHAR(64)  NOT NULL UNIQUE,
  sku              VARCHAR(32)  NOT NULL,
  subject          VARCHAR(256) NOT NULL,
  total_amount     NUMERIC(12,2) NOT NULL,
  status           VARCHAR(24)  NOT NULL DEFAULT 'CREATED',
  trade_no         VARCHAR(64),
  buyer_id         VARCHAR(128),
  buyer_open_id    VARCHAR(128),
  app_id           VARCHAR(32),
  seller_id        VARCHAR(30),
  wallet_address   VARCHAR(42),
  session_id       BIGINT,
  paid_at          TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  refunded_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  raw_notify       JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pay_orders_wallet  ON pay_orders(wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pay_orders_status  ON pay_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pay_orders_trade   ON pay_orders(trade_no);

CREATE TABLE IF NOT EXISTS pay_notify_events (
  id            BIGSERIAL PRIMARY KEY,
  notify_id     VARCHAR(128) NOT NULL UNIQUE,
  out_trade_no  VARCHAR(64)  NOT NULL,
  trade_no      VARCHAR(64),
  trade_status  VARCHAR(32),
  raw_params    JSONB        NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pay_notify_out_trade ON pay_notify_events(out_trade_no);
`;

let schemaReady: Promise<void> | null = null;

/** 幂等建表；失败不缓存，下次请求重试 */
export function ensurePaySchema(pool: Pool): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool
      .query(DDL)
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}

/** 测试用：清掉建表缓存 */
export function resetPaySchemaCache(): void {
  schemaReady = null;
}

export interface CreateOrderInput {
  outTradeNo: string;
  sku: string;
  subject: string;
  totalAmount: string;
  walletAddress?: string | null;
  sessionId?: number | null;
}

export async function createOrder(pool: Pool, input: CreateOrderInput): Promise<PayOrder> {
  await ensurePaySchema(pool);
  const { rows } = await pool.query<PayOrder>(
    `INSERT INTO pay_orders (out_trade_no, sku, subject, total_amount, wallet_address, session_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.outTradeNo,
      input.sku,
      input.subject,
      input.totalAmount,
      input.walletAddress ?? null,
      input.sessionId ?? null,
    ]
  );
  return rows[0];
}

export async function findOrderByOutTradeNo(pool: Pool, outTradeNo: string): Promise<PayOrder | null> {
  await ensurePaySchema(pool);
  const { rows } = await pool.query<PayOrder>(
    `SELECT * FROM pay_orders WHERE out_trade_no = $1 LIMIT 1`,
    [outTradeNo]
  );
  return rows[0] ?? null;
}

export async function listOrdersByWallet(pool: Pool, walletAddress: string, limit = 50): Promise<PayOrder[]> {
  await ensurePaySchema(pool);
  const { rows } = await pool.query<PayOrder>(
    `SELECT * FROM pay_orders WHERE wallet_address = $1 ORDER BY created_at DESC LIMIT $2`,
    [walletAddress.toLowerCase(), Math.min(Math.max(limit, 1), 200)]
  );
  return rows;
}

export interface NotifyEventInput {
  notifyId: string;
  outTradeNo: string;
  tradeNo?: string | null;
  tradeStatus?: string | null;
  rawParams: Record<string, unknown>;
}

/** 通知去重：首次插入返回 true，重复通知返回 false */
export async function recordNotifyEvent(pool: Pool, input: NotifyEventInput): Promise<boolean> {
  await ensurePaySchema(pool);
  const { rowCount } = await pool.query(
    `INSERT INTO pay_notify_events (notify_id, out_trade_no, trade_no, trade_status, raw_params)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (notify_id) DO NOTHING`,
    [
      input.notifyId,
      input.outTradeNo,
      input.tradeNo ?? null,
      input.tradeStatus ?? null,
      JSON.stringify(input.rawParams),
    ]
  );
  return (rowCount ?? 0) > 0;
}

export interface PaidInput {
  outTradeNo: string;
  tradeNo: string;
  appId: string;
  sellerId?: string | null;
  buyerId?: string | null;
  buyerOpenId?: string | null;
  rawParams: Record<string, unknown>;
}

/**
 * 标记已支付。条件更新保证幂等：已经是 PAID 时不再改动，返回 false。
 * 返回 true 表示「本次调用完成了 CREATED → PAID 的状态迁移」，
 * 调用方据此决定是否发放权益（发货）。
 */
export async function markPaidIdempotent(pool: Pool, input: PaidInput): Promise<boolean> {
  await ensurePaySchema(pool);
  const { rowCount } = await pool.query(
    `UPDATE pay_orders
        SET status = 'PAID',
            trade_no = $2,
            app_id = $3,
            seller_id = $4,
            buyer_id = $5,
            buyer_open_id = $6,
            paid_at = now(),
            updated_at = now(),
            raw_notify = $7::jsonb
      WHERE out_trade_no = $1
        AND status <> 'PAID'`,
    [
      input.outTradeNo,
      input.tradeNo,
      input.appId,
      input.sellerId ?? null,
      input.buyerId ?? null,
      input.buyerOpenId ?? null,
      JSON.stringify(input.rawParams),
    ]
  );
  return (rowCount ?? 0) > 0;
}

/** 记录非付款成功的交易事件（TRADE_CLOSED 等），不改变已支付订单 */
export async function recordTradeStatus(
  pool: Pool,
  outTradeNo: string,
  tradeStatus: string,
  rawParams: Record<string, unknown>
): Promise<void> {
  await ensurePaySchema(pool);
  const closed = tradeStatus === 'TRADE_CLOSED';
  await pool.query(
    `UPDATE pay_orders
        SET status = CASE
                       WHEN status IN ('PAID', 'REFUNDED', 'PARTIAL_REFUNDED') THEN status
                       ELSE $2
                     END,
            closed_at = CASE WHEN $3 THEN now() ELSE closed_at END,
            updated_at = now(),
            raw_notify = $4::jsonb
      WHERE out_trade_no = $1`,
    [outTradeNo, closed ? 'CLOSED' : 'CREATED', closed, JSON.stringify(rawParams)]
  );
}

/** 退款成功后累加已退金额并推进状态 */
export async function applyRefund(
  pool: Pool,
  outTradeNo: string,
  refundAmount: string
): Promise<PayOrder | null> {
  await ensurePaySchema(pool);
  const { rows } = await pool.query<PayOrder>(
    `UPDATE pay_orders
        SET refunded_amount = refunded_amount + $2::numeric,
            status = CASE
                       WHEN refunded_amount + $2::numeric >= total_amount THEN 'REFUNDED'
                       ELSE 'PARTIAL_REFUNDED'
                     END,
            updated_at = now()
      WHERE out_trade_no = $1
      RETURNING *`,
    [outTradeNo, refundAmount]
  );
  return rows[0] ?? null;
}

/** 生成商户订单号：时间前缀 + 随机段，≤64 字符，全局唯一 */
export function newOutTradeNo(prefix = 'GM'): string {
  const now = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const random = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}${stamp}${random}`;
}
