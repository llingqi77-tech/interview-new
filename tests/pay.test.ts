import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import {
  amountEquals,
  alipayTimestamp,
  buildPagePayForm,
  buildSignContent,
  normalizeAmount,
  readAlipayConfig,
  signParams,
  toPem,
  verifyNotifySign,
  type AlipayConfig,
} from '../api/_lib/alipay.ts';
import { DEFAULT_CATALOG, findSku, getCatalog, resetCatalogCache } from '../api/_lib/payCatalog.ts';
import { newOutTradeNo } from '../api/_lib/payStore.ts';
import payHandler from '../api/pay.ts';

/**
 * 支付宝 AI 网页应用收款 —— 协议与端点测试
 *
 * 重点覆盖「手写 RSA2 实现」的正确性：签名/验签必须能自洽往返，
 * 篡改任一字段必须验签失败。这是不引 alipay-sdk 之后唯一的安全网。
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

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
      res.headers[key] = value;
      return res;
    },
  };
  return res;
}

function mockReq(init: { method?: string; query?: Record<string, string>; body?: unknown } = {}) {
  return {
    method: init.method ?? 'GET',
    query: init.query ?? {},
    body: init.body,
    headers: {},
    url: '/api/pay',
    socket: { remoteAddress: '127.0.0.1' },
  } as any;
}

// ---------------------------------------------------------------- 签名内容

test('buildSignContent：按 ASCII 升序、剔除空值、剔除指定字段', () => {
  const content = buildSignContent(
    {
      b: '2',
      a: '1',
      empty: '',
      nil: null,
      undef: undefined,
      sign: 'SHOULD_BE_EXCLUDED',
      sign_type: 'RSA2',
    },
    ['sign']
  );
  assert.equal(content, 'a=1&b=2&sign_type=RSA2');
});

test('buildSignContent：通知验签同时剔除 sign 与 sign_type', () => {
  const content = buildSignContent(
    { out_trade_no: 'X1', sign: 'S', sign_type: 'RSA2', total_amount: '9.90' },
    ['sign', 'sign_type']
  );
  assert.equal(content, 'out_trade_no=X1&total_amount=9.90');
});

// ---------------------------------------------------------------- 签名 / 验签

test('signParams + verifyNotifySign：自洽往返', () => {
  const params = {
    app_id: '2021000000000000',
    notify_id: 'n-1',
    out_trade_no: 'GM20260101000000ABCD',
    total_amount: '9.90',
    trade_status: 'TRADE_SUCCESS',
  };
  const sign = signParams(params, PRIVATE_PEM);
  assert.ok(sign.length > 0);

  // 通知里会带 sign_type，验签时必须被剔除
  assert.equal(verifyNotifySign({ ...params, sign, sign_type: 'RSA2' }, PUBLIC_PEM), true);
});

test('verifyNotifySign：篡改金额必须失败', () => {
  const params = { out_trade_no: 'X1', total_amount: '9.90', notify_id: 'n-2' };
  const sign = signParams(params, PRIVATE_PEM);
  assert.equal(verifyNotifySign({ ...params, sign }, PUBLIC_PEM), true);
  assert.equal(verifyNotifySign({ ...params, total_amount: '0.01', sign }, PUBLIC_PEM), false);
});

test('verifyNotifySign：缺 sign / 错公钥 / 垃圾签名都返回 false，不抛异常', () => {
  const params = { out_trade_no: 'X1', total_amount: '9.90' };
  const sign = signParams(params, PRIVATE_PEM);

  assert.equal(verifyNotifySign({ ...params }, PUBLIC_PEM), false);

  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherPublic = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.equal(verifyNotifySign({ ...params, sign }, otherPublic), false);

  assert.equal(verifyNotifySign({ ...params, sign: 'not-base64!!' }, PUBLIC_PEM), false);
});

test('signParams：RSA2 用 SHA256withRSA，与 node:crypto 直接签名一致', () => {
  const params = { a: '1', b: '2' };
  const expected = createSign('RSA-SHA256')
    .update('a=1&b=2', 'utf8')
    .sign(PRIVATE_PEM, 'base64');
  assert.equal(signParams(params, PRIVATE_PEM, 'RSA2'), expected);
});

// ---------------------------------------------------------------- 密钥格式

test('toPem：单行 base64 自动包成 PEM', () => {
  const body = PRIVATE_PEM.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const pem = toPem(body, 'private', 'PKCS1');
  assert.match(pem, /^-----BEGIN RSA PRIVATE KEY-----/);
  assert.match(pem, /-----END RSA PRIVATE KEY-----\n$/);
  // 包出来的 PEM 必须能真的签名
  assert.ok(signParams({ a: '1' }, pem).length > 0);
});

test('toPem：PKCS8 标签正确', () => {
  const body = PRIVATE_PEM.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  assert.match(toPem(body, 'private', 'PKCS8'), /^-----BEGIN PRIVATE KEY-----/);
});

test('toPem：完整 PEM 里的字面量 \\n 会被还原', () => {
  const oneLine = PRIVATE_PEM.trim().replace(/\n/g, '\\n');
  const pem = toPem(oneLine, 'private');
  assert.ok(pem.includes('\n'));
  assert.ok(signParams({ a: '1' }, pem).length > 0);
});

test('toPem：非法 base64 抛错', () => {
  assert.throws(() => toPem('这不是密钥', 'private'), /base64/);
});

// ---------------------------------------------------------------- 金额

test('normalizeAmount：归一为两位小数字符串', () => {
  assert.equal(normalizeAmount('9.9'), '9.90');
  assert.equal(normalizeAmount('9'), '9.00');
  assert.equal(normalizeAmount(9.9), '9.90');
  assert.equal(normalizeAmount('0.01'), '0.01');
  assert.equal(normalizeAmount('abc'), null);
  assert.equal(normalizeAmount('9.999'), null);
  assert.equal(normalizeAmount(null), null);
});

test('amountEquals：定点比较，不受浮点误差影响', () => {
  assert.equal(amountEquals('9.90', '9.9'), true);
  assert.equal(amountEquals('9.90', '9.91'), false);
  assert.equal(amountEquals('0.1', '0.10'), true);
  assert.equal(amountEquals('abc', '0.10'), false);
});

// ---------------------------------------------------------------- 时间戳

test('alipayTimestamp：yyyy-MM-dd HH:mm:ss，北京时间', () => {
  const stamp = alipayTimestamp(new Date('2026-01-02T03:04:05Z'));
  assert.equal(stamp, '2026-01-02 11:04:05');
  assert.match(stamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

// ---------------------------------------------------------------- 表单

test('buildPagePayForm：包含 form、网关、biz_content 与 sign', () => {
  const config: AlipayConfig = {
    appId: '2021000000000000',
    privateKeyPem: PRIVATE_PEM,
    alipayPublicKeyPem: PUBLIC_PEM,
    gateway: 'https://openapi.alipay.com/gateway.do',
    notifyUrl: 'https://example.com/api/pay?action=notify',
    returnUrl: 'https://example.com/api/pay?action=return',
    signType: 'RSA2',
  };
  const html = buildPagePayForm(config, {
    outTradeNo: 'GM20260101000000ABCD',
    totalAmount: '9.90',
    subject: '群面模拟 5 场',
  });

  assert.match(html, /<form[^>]+method="post"/);
  assert.match(html, /action="https:\/\/openapi\.alipay\.com\/gateway\.do/);
  assert.match(html, /name="method" value="alipay\.trade\.page\.pay"/);
  assert.match(html, /&quot;product_code&quot;:&quot;FAST_INSTANT_TRADE_PAY&quot;/);
  assert.match(html, /name="sign" value="[A-Za-z0-9+/=]+"/);
  assert.match(html, /document\.forms\[0\]\.submit\(\)/);
});

// ---------------------------------------------------------------- 配置读取

test('readAlipayConfig：缺项返回 null', () => {
  const saved = { ...process.env };
  delete process.env.ALIPAY_APP_ID;
  delete process.env.ALIPAY_PRIVATE_KEY;
  delete process.env.ALIPAY_PUBLIC_KEY;
  try {
    assert.equal(readAlipayConfig(), null);
  } finally {
    Object.assign(process.env, saved);
  }
});

// ---------------------------------------------------------------- 商品目录

test('getCatalog：默认目录通过校验，金额归一为两位小数', () => {
  resetCatalogCache();
  const catalog = getCatalog();
  assert.equal(catalog.length, DEFAULT_CATALOG.length);
  for (const sku of catalog) {
    assert.match(sku.amount, /^\d+\.\d{2}$/);
    assert.match(sku.sku, /^[a-z0-9_-]{1,32}$/);
  }
});

test('findSku：命中与未命中', () => {
  resetCatalogCache();
  assert.ok(findSku('practice_5'));
  assert.equal(findSku('nope'), null);
});

test('getCatalog：ALIPAY_PAY_CATALOG 覆盖生效，非法配置回退默认', () => {
  const saved = process.env.ALIPAY_PAY_CATALOG;
  try {
    process.env.ALIPAY_PAY_CATALOG = JSON.stringify([
      { sku: 'custom_1', subject: '自定义商品', amount: '1.5' },
    ]);
    resetCatalogCache();
    assert.equal(getCatalog().length, 1);
    assert.equal(getCatalog()[0].amount, '1.50');

    process.env.ALIPAY_PAY_CATALOG = '{ not json';
    resetCatalogCache();
    assert.equal(getCatalog().length, DEFAULT_CATALOG.length);
  } finally {
    if (saved === undefined) delete process.env.ALIPAY_PAY_CATALOG;
    else process.env.ALIPAY_PAY_CATALOG = saved;
    resetCatalogCache();
  }
});

// ---------------------------------------------------------------- 订单号

test('newOutTradeNo：≤64 字符、前缀正确、两次不重复', () => {
  const a = newOutTradeNo();
  const b = newOutTradeNo();
  assert.ok(a.length <= 64);
  assert.match(a, /^GM\d{14}[A-Z0-9]{1,8}$/);
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------- 端点

test('/api/pay?action=catalog：未配置支付宝时 configured=false，仍返回商品目录', async () => {
  const saved = { ...process.env };
  delete process.env.ALIPAY_APP_ID;
  delete process.env.ALIPAY_PRIVATE_KEY;
  delete process.env.ALIPAY_PUBLIC_KEY;
  resetCatalogCache();
  try {
    const res = mockRes();
    await payHandler(mockReq({ query: { action: 'catalog' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.alipay.configured, false);
    assert.ok(Array.isArray(res.body.skus));
    assert.ok(res.body.skus.length > 0);
  } finally {
    Object.assign(process.env, saved);
    resetCatalogCache();
  }
});

test('/api/pay?action=create：未配置支付宝返回 503', async () => {
  const saved = { ...process.env };
  delete process.env.ALIPAY_APP_ID;
  delete process.env.ALIPAY_PRIVATE_KEY;
  delete process.env.ALIPAY_PUBLIC_KEY;
  try {
    const res = mockRes();
    await payHandler(mockReq({ method: 'POST', query: { action: 'create' }, body: { sku: 'practice_5' } }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'ALIPAY_NOT_CONFIGURED');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('/api/pay?action=notify：验签失败回纯文本 fail', async () => {
  const saved = { ...process.env };
  process.env.ALIPAY_APP_ID = '2021000000000000';
  process.env.ALIPAY_PRIVATE_KEY = PRIVATE_PEM;
  process.env.ALIPAY_PUBLIC_KEY = PUBLIC_PEM;
  try {
    const res = mockRes();
    await payHandler(
      mockReq({
        method: 'POST',
        query: { action: 'notify' },
        body: {
          app_id: '2021000000000000',
          out_trade_no: 'X1',
          total_amount: '9.90',
          trade_status: 'TRADE_SUCCESS',
          notify_id: 'n-3',
          sign: 'forged',
          sign_type: 'RSA2',
        },
      }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'fail');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('/api/pay?action=refund：未配置 ALIPAY_ADMIN_TOKEN 时 403', async () => {
  const saved = { ...process.env };
  process.env.ALIPAY_APP_ID = '2021000000000000';
  process.env.ALIPAY_PRIVATE_KEY = PRIVATE_PEM;
  process.env.ALIPAY_PUBLIC_KEY = PUBLIC_PEM;
  delete process.env.ALIPAY_ADMIN_TOKEN;
  try {
    const res = mockRes();
    await payHandler(
      mockReq({ method: 'POST', query: { action: 'refund' }, body: { out_trade_no: 'X1' } }),
      res
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'ADMIN_TOKEN_REQUIRED');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('/api/pay?action=unknown：404', async () => {
  const saved = { ...process.env };
  process.env.ALIPAY_APP_ID = '2021000000000000';
  process.env.ALIPAY_PRIVATE_KEY = PRIVATE_PEM;
  process.env.ALIPAY_PUBLIC_KEY = PUBLIC_PEM;
  try {
    const res = mockRes();
    await payHandler(mockReq({ query: { action: 'nope' } }), res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'UNKNOWN_ACTION');
  } finally {
    Object.assign(process.env, saved);
  }
});
