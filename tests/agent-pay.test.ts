import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  hashRequest,
  newAgentOutTradeNo,
  parsePaymentProof,
  payBeforeISO,
  readAgentServiceConfig,
} from '../api/_lib/agentPay.ts';
import { setPoolForTesting } from '../api/_lib/db.ts';
import { resetPaySchemaCache } from '../api/_lib/payStore.ts';
import payHandler from '../api/pay.ts';

/**
 * AI 按量付费（Machine Pay）—— 402 协议与端点测试
 *
 * 覆盖：配置读取、请求指纹、Payment-Proof 解析、支付截止时间、订单号长度，
 * 以及端点四条主路径（405 / 503 / 400 / 402）。
 * 网关调用用 stub fetch 拦截，不打真实支付宝。
 */

const ENV_KEYS = [
  'ALIPAY_APP_ID',
  'ALIPAY_PRIVATE_KEY',
  'ALIPAY_PUBLIC_KEY',
  'ALIPAY_AGENT_SERVICE_ID',
  'ALIPAY_AGENT_PRICE',
  'ALIPAY_AGENT_GOODS_NAME',
  'DATABASE_URL',
  'POSTGRES_URL',
  'DEEPSEEK_API_KEY',
] as const;

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  resetPaySchemaCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  setPoolForTesting(null);
  resetPaySchemaCache();
});

function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    send(data: unknown) {
      res.body = data;
      return res;
    },
    type(value: string) {
      res.headers['content-type'] = value;
      return res;
    },
    setHeader(key: string, value: string) {
      res.headers[key.toLowerCase()] = value;
      return res;
    },
  };
  return res;
}

function mockReq(init: { method?: string; query?: Record<string, string>; body?: unknown; headers?: Record<string, string>; url?: string } = {}) {
  return {
    method: init.method ?? 'POST',
    query: init.query ?? {},
    body: init.body,
    headers: init.headers ?? {},
    url: init.url ?? '/api/agent/interview',
    socket: { remoteAddress: '127.0.0.1' },
  } as any;
}

/** 只处理支付订单表相关 SQL 的假连接池 */
function mockPool() {
  const pool: any = {
    query: async (sql: string) => {
      if (/CREATE TABLE|ALTER TABLE|CREATE INDEX/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/SELECT \* FROM pay_orders/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO pay_orders/i.test(sql)) {
        return {
          rows: [
            {
              out_trade_no: 'AGTEST0001',
              sku: 'agent_interview',
              subject: 'AI 群面模拟',
              total_amount: '3.00',
              status: 'CREATED',
              request_hash: 'x',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return pool;
}

const { privateKey: TEST_PRIVATE, publicKey: TEST_PUBLIC } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const TEST_PRIVATE_B64 = TEST_PRIVATE.export({ type: 'pkcs1', format: 'pem' })
  .toString()
  .replace(/-----[^-]+-----/g, '')
  .replace(/\s+/g, '');
const TEST_PUBLIC_B64 = TEST_PUBLIC.export({ type: 'spki', format: 'pem' })
  .toString()
  .replace(/-----[^-]+-----/g, '')
  .replace(/\s+/g, '');

function configureAll() {
  process.env.ALIPAY_APP_ID = '2021000000000000';
  process.env.ALIPAY_PRIVATE_KEY = TEST_PRIVATE_B64;
  process.env.ALIPAY_PUBLIC_KEY = TEST_PUBLIC_B64;
  process.env.ALIPAY_AGENT_SERVICE_ID = 'API_67A60134AB7A4BCE';
  process.env.ALIPAY_AGENT_PRICE = '3.00';
  process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
  process.env.DEEPSEEK_API_KEY = 'sk-test';
}

// ---------------------------------------------------------------- 配置

test('readAgentServiceConfig：缺项返回 null', () => {
  delete process.env.ALIPAY_AGENT_SERVICE_ID;
  delete process.env.ALIPAY_AGENT_PRICE;
  assert.equal(readAgentServiceConfig(), null);
});

test('readAgentServiceConfig：单价越界或非法返回 null', () => {
  process.env.ALIPAY_AGENT_SERVICE_ID = 'API_X';
  for (const bad of ['0', '0.001', '50.01', 'abc', '-1']) {
    process.env.ALIPAY_AGENT_PRICE = bad;
    assert.equal(readAgentServiceConfig(), null, `应拒绝单价 ${bad}`);
  }
});

test('readAgentServiceConfig：合法配置归一为两位小数', () => {
  process.env.ALIPAY_AGENT_SERVICE_ID = 'API_67A60134AB7A4BCE';
  process.env.ALIPAY_AGENT_PRICE = '3';
  process.env.ALIPAY_AGENT_GOODS_NAME = 'AI 群面模拟';
  const config = readAgentServiceConfig();
  assert.equal(config?.price, '3.00');
  assert.equal(config?.serviceId, 'API_67A60134AB7A4BCE');
  assert.equal(config?.goodsName, 'AI 群面模拟');
});

// ---------------------------------------------------------------- 请求指纹

test('hashRequest：键顺序无关，内容不同则不同', () => {
  const a = hashRequest({ job_title: '产品经理', company: '字节跳动', format: 'lgd' });
  const b = hashRequest({ format: 'lgd', company: '字节跳动', job_title: '产品经理' });
  const c = hashRequest({ job_title: '产品经理', company: '腾讯', format: 'lgd' });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------- Payment-Proof

test('parsePaymentProof：解析 base64 JSON', () => {
  const payload = {
    protocol: { payment_proof: 'proof-abc', trade_no: '20260324008281172041220000012182' },
    method: { client_session: 'sess-xyz' },
  };
  const header = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const parsed = parsePaymentProof(header);
  assert.equal(parsed?.paymentProof, 'proof-abc');
  assert.equal(parsed?.tradeNo, '20260324008281172041220000012182');
  assert.equal(parsed?.clientSession, 'sess-xyz');
});

test('parsePaymentProof：缺字段 / 非 base64 / 非 JSON 都返回 null', () => {
  assert.equal(parsePaymentProof(undefined), null);
  assert.equal(parsePaymentProof(''), null);
  assert.equal(parsePaymentProof('!!!not-base64!!!'), null);
  assert.equal(parsePaymentProof(Buffer.from('not json').toString('base64')), null);
  assert.equal(
    parsePaymentProof(Buffer.from(JSON.stringify({ protocol: { trade_no: 'x' } })).toString('base64')),
    null
  );
});

// ---------------------------------------------------------------- 时间与订单号

test('payBeforeISO：ISO8601 带 +08:00，且不超过 12 小时', () => {
  const now = new Date('2026-11-02T00:00:00Z');
  const iso = payBeforeISO(2, now);
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
  const delta = new Date(iso).getTime() - now.getTime();
  assert.equal(delta, 2 * 3600_000);
  assert.ok(delta <= 12 * 3600_000);
});

test('newAgentOutTradeNo：≤32 字符、AG 前缀、两次不重复', () => {
  const a = newAgentOutTradeNo();
  const b = newAgentOutTradeNo();
  assert.ok(a.length <= 32, `订单号过长：${a.length}`);
  assert.match(a, /^AG[0-9A-Z]+$/);
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------- 端点

test('GET /api/agent/interview → 405', async () => {
  const res = mockRes();
  await payHandler(mockReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('未配置支付宝 → 503', async () => {
  delete process.env.ALIPAY_APP_ID;
  delete process.env.ALIPAY_PRIVATE_KEY;
  delete process.env.ALIPAY_PUBLIC_KEY;
  const res = mockRes();
  await payHandler(mockReq({ body: { job_title: '产品经理', company: '字节跳动' } }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'ALIPAY_NOT_CONFIGURED');
});

test('未配置按量付费服务 → 503', async () => {
  configureAll();
  delete process.env.ALIPAY_AGENT_SERVICE_ID;
  const res = mockRes();
  await payHandler(mockReq({ body: { job_title: '产品经理', company: '字节跳动' } }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'AGENT_SERVICE_NOT_CONFIGURED');
});

test('请求体缺 job_title / company → 400', async () => {
  configureAll();
  setPoolForTesting(mockPool());
  const res = mockRes();
  await payHandler(mockReq({ body: { company: '字节跳动' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_REQUEST');
});

test('无 Payment-Proof → 402 + amtPaymentLink 响应头', async () => {
  configureAll();
  setPoolForTesting(mockPool());

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        alipay_aipay_agent_payment_precreate_response: {
          code: '10000',
          msg: 'Success',
          amt_pre_pay_id: 'amtpp_test_123',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;

  try {
    const res = mockRes();
    await payHandler(
      mockReq({ body: { job_title: '产品经理', company: '字节跳动', format: 'lgd', duration_minutes: 25 } }),
      res
    );
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.error, 'PAYMENT_REQUIRED');
    assert.equal(res.body.amount, '3.00');
    assert.equal(res.body.amt_payment_link, 'amtpp_test_123');
    assert.equal(res.headers['amtpaymentlink'], 'amtpp_test_123');
    assert.ok(res.body.out_trade_no);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Payment-Proof 验签不通过 → 402 PAYMENT_INVALID', async () => {
  configureAll();
  setPoolForTesting(mockPool());

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        alipay_aipay_agent_payment_verify_response: {
          code: '10000',
          msg: 'Success',
          active: false,
          amount: '3.00',
          out_trade_no: 'AGTEST0001',
          trade_no: '20260324008281172041220000012182',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;

  try {
    const proof = Buffer.from(
      JSON.stringify({
        protocol: { payment_proof: 'p', trade_no: '20260324008281172041220000012182' },
        method: { client_session: 's' },
      })
    ).toString('base64');

    const res = mockRes();
    await payHandler(
      mockReq({
        body: { job_title: '产品经理', company: '字节跳动' },
        headers: { 'payment-proof': proof },
      }),
      res
    );
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.error, 'PAYMENT_INVALID');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('凭证金额与服务单价不一致 → 402 AMOUNT_MISMATCH', async () => {
  configureAll();
  setPoolForTesting(mockPool());

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        alipay_aipay_agent_payment_verify_response: {
          code: '10000',
          msg: 'Success',
          active: true,
          amount: '0.01',
          out_trade_no: 'AGTEST0001',
          trade_no: '20260324008281172041220000012182',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;

  try {
    const proof = Buffer.from(
      JSON.stringify({
        protocol: { payment_proof: 'p', trade_no: '20260324008281172041220000012182' },
      })
    ).toString('base64');

    const res = mockRes();
    await payHandler(
      mockReq({
        body: { job_title: '产品经理', company: '字节跳动' },
        headers: { 'payment-proof': proof },
      }),
      res
    );
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.error, 'AMOUNT_MISMATCH');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
