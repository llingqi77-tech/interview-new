-- v0.9：支付宝 AI 网页应用收款（Vibe Pay 基础收款能力）
-- 前置：db/migration-v0.7.sql 已执行
-- 幂等：可重复执行
--
-- 与 api/_lib/payStore.ts 的 DDL 常量必须保持一致：
-- 服务端首次调用支付接口时会自动幂等建表，本文件用于手工预建 / 审计 / 回滚参考。

CREATE TABLE IF NOT EXISTS pay_orders (
  id               BIGSERIAL PRIMARY KEY,
  out_trade_no     VARCHAR(64)  NOT NULL UNIQUE,   -- 商户订单号，支付宝侧唯一
  sku              VARCHAR(32)  NOT NULL,          -- 商品标识（api/_lib/payCatalog.ts）
  subject          VARCHAR(256) NOT NULL,          -- 收银台标题
  total_amount     NUMERIC(12,2) NOT NULL,         -- 订单金额（元），定点数，禁止浮点
  status           VARCHAR(24)  NOT NULL DEFAULT 'CREATED',
                                                   -- CREATED | PAID | CLOSED | REFUNDED | PARTIAL_REFUNDED
  trade_no         VARCHAR(64),                    -- 支付宝交易号
  buyer_id         VARCHAR(128),
  buyer_open_id    VARCHAR(128),
  app_id           VARCHAR(32),
  seller_id        VARCHAR(30),
  wallet_address   VARCHAR(42),                    -- 下单时关联的 Para 钱包（小写）
  session_id       BIGINT,                         -- 可选：关联的练习场次
  paid_at          TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  refunded_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  raw_notify       JSONB,                          -- 最近一次通知原文（已剔除 sign）
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pay_orders_wallet  ON pay_orders(wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pay_orders_status  ON pay_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pay_orders_trade   ON pay_orders(trade_no);

-- 异步通知去重表：支付宝重试同一条通知时 notify_id 不变，唯一约束天然幂等
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

-- 说明：
-- - 支付结果只认「异步通知验签通过」或「alipay.trade.query 返回 TRADE_SUCCESS/TRADE_FINISHED」
-- - 同步回跳（return_url）参数可伪造，只用于展示，不推进状态
-- - 发货（加次数 / 开权益）挂在 markPaidIdempotent 返回 true 的分支上，重复通知不会重复发货
