#!/usr/bin/env node
/**
 * 支付宝支付配置自检（pay-doctor）
 *
 * 用法：
 *   node scripts/pay-doctor.mjs
 *   node scripts/pay-doctor.mjs --env .env.local
 *
 * 它做什么：
 *   1. 读环境变量（默认尝试 .env.local / .env）
 *   2. 检查必填项是否齐全
 *   3. 真的解析一次私钥、真的签一次名 —— 密钥格式不对这里就会报
 *   4. 检查公钥能不能被 crypto 接受
 *   5. 检查 notify_url / return_url 是否像公网 HTTPS
 *   6. 打印一份「接下来该做什么」清单
 *
 * 它不做什么：不联网、不下单、不扣钱。纯本地检查。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicKey } from 'node:crypto';

const args = process.argv.slice(2);
const envFlagIndex = args.indexOf('--env');
const explicitEnv = envFlagIndex >= 0 ? args[envFlagIndex + 1] : null;

// ---- 1. 载入环境变量 -------------------------------------------------------

function loadEnvFile(path) {
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // 去掉行尾注释（只在值不含引号时）
    if (!/^['"]/.test(value)) value = value.replace(/\s+#.*$/, '');
    if (/^['"].*['"]$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

const candidates = explicitEnv ? [explicitEnv] : ['.env.local', '.env'];
let loadedFrom = null;
for (const candidate of candidates) {
  if (loadEnvFile(resolve(process.cwd(), candidate))) {
    loadedFrom = candidate;
    break;
  }
}

// ---- 2. 输出工具 -----------------------------------------------------------

const OK = '  [OK]  ';
const WARN = '  [WARN]';
const FAIL = '  [FAIL]';
let failures = 0;
let warnings = 0;

const ok = (msg) => console.log(`${OK} ${msg}`);
const warn = (msg) => {
  warnings += 1;
  console.log(`${WARN} ${msg}`);
};
const fail = (msg) => {
  failures += 1;
  console.log(`${FAIL} ${msg}`);
};

const env = (name) => (process.env[name] ?? '').trim();

console.log('\n=== 支付宝支付配置自检 ===\n');
console.log(loadedFrom ? `环境文件：${loadedFrom}` : '环境文件：未找到 .env.local / .env，只用当前进程环境变量');
console.log('');

// ---- 3. 必填项 -------------------------------------------------------------

const appId = env('ALIPAY_APP_ID');
const privateKeyRaw = env('ALIPAY_PRIVATE_KEY');
const publicKeyRaw = env('ALIPAY_PUBLIC_KEY');
const gateway = env('ALIPAY_GATEWAY') || 'https://openapi.alipay.com/gateway.do';
const notifyUrl = env('ALIPAY_NOTIFY_URL');
const returnUrl = env('ALIPAY_RETURN_URL');
const adminToken = env('ALIPAY_ADMIN_TOKEN');
const keyType = env('ALIPAY_KEY_TYPE').toUpperCase() === 'PKCS8' ? 'PKCS8' : 'PKCS1';
const signType = env('ALIPAY_SIGN_TYPE').toUpperCase() === 'RSA' ? 'RSA' : 'RSA2';

console.log('--- 必填项 ---');
if (!appId) fail('ALIPAY_APP_ID 未配置');
else if (!/^\d{16}$/.test(appId)) warn(`ALIPAY_APP_ID 不是 16 位数字：${appId}（确认没填错）`);
else ok(`ALIPAY_APP_ID = ${appId}`);

if (!privateKeyRaw) fail('ALIPAY_PRIVATE_KEY 未配置');
if (!publicKeyRaw) fail('ALIPAY_PUBLIC_KEY 未配置');

// ---- 4. 密钥解析（真的解析，不是看长度） -----------------------------------

const { toPem, signParams, buildSignContent, alipayTimestamp } = await import('../api/_lib/alipay.ts');

console.log('\n--- 密钥 ---');
let privatePem = null;
if (privateKeyRaw) {
  try {
    privatePem = toPem(privateKeyRaw, 'private', keyType);
    const signature = signParams({ probe: 'pay-doctor', ts: alipayTimestamp() }, privatePem, signType);
    if (signature && signature.length > 0) {
      ok(`应用私钥可解析（${keyType}），签名成功（${signType}，${signature.length} 字符）`);
    } else {
      fail('应用私钥签名返回空');
    }
  } catch (error) {
    privatePem = null;
    fail(`应用私钥无法使用：${error instanceof Error ? error.message : String(error)}`);
    console.log('        常见原因：复制时漏了字符、换行被吃掉、PKCS#1/PKCS#8 选错（试 ALIPAY_KEY_TYPE=PKCS8）');
  }
}

if (publicKeyRaw) {
  try {
    const publicPem = toPem(publicKeyRaw, 'public');
    const key = createPublicKey(publicPem);
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (bits === 2048) ok('支付宝公钥可解析（RSA 2048）');
    else warn(`支付宝公钥可解析，但长度是 ${bits} 位（支付宝要求 2048）`);
  } catch (error) {
    fail(`支付宝公钥无法解析：${error instanceof Error ? error.message : String(error)}`);
    console.log('        常见原因：填成了「应用公钥」而不是「支付宝公钥」，或复制不完整');
  }
}

// ---- 5. 网关与回调地址 -----------------------------------------------------

console.log('\n--- 网关与回调 ---');
const isSandbox = gateway.includes('alipaydev.com');
if (isSandbox) warn(`当前是沙箱网关：${gateway}（不会产生真实扣款）`);
else if (gateway === 'https://openapi.alipay.com/gateway.do') ok(`生产网关：${gateway}`);
else warn(`网关不是标准地址：${gateway}`);

function checkCallback(name, value, expectedAction) {
  if (!value) {
    warn(`${name} 未配置（本地联调可以跳过，上线必须配）`);
    return;
  }
  if (!/^https:\/\//.test(value)) {
    fail(`${name} 必须是 https：${value}`);
    return;
  }
  if (/\s/.test(value)) {
    fail(`${name} 含空格，支付宝会收不到：${value}`);
    return;
  }
  if (value.includes('localhost') || value.includes('127.0.0.1')) {
    warn(`${name} 指向本机，支付宝访问不到：${value}`);
    return;
  }
  if (expectedAction && !value.includes(expectedAction)) {
    warn(`${name} 里没有 ${expectedAction}，确认路径对不对：${value}`);
    return;
  }
  ok(`${name} = ${value}`);
}

checkCallback('ALIPAY_NOTIFY_URL', notifyUrl, 'action=notify');
checkCallback('ALIPAY_RETURN_URL', returnUrl, 'action=return');

// ---- 6. 其它 ---------------------------------------------------------------

console.log('\n--- 其它 ---');
if (adminToken) {
  if (adminToken.length < 16) warn(`ALIPAY_ADMIN_TOKEN 只有 ${adminToken.length} 字符，建议 ≥32`);
  else ok('ALIPAY_ADMIN_TOKEN 已配置（退款/关单可用）');
} else {
  warn('ALIPAY_ADMIN_TOKEN 未配置 → 退款 / 关单接口会直接返回 403（安全默认）');
}

if (env('DATABASE_URL') || env('POSTGRES_URL')) ok('DATABASE_URL 已配置（订单可落库）');
else fail('DATABASE_URL 未配置 → 下单会返回 503');

const catalogRaw = env('ALIPAY_PAY_CATALOG');
if (catalogRaw) {
  try {
    const parsed = JSON.parse(catalogRaw);
    if (Array.isArray(parsed) && parsed.length > 0) ok(`ALIPAY_PAY_CATALOG 覆盖生效（${parsed.length} 个商品）`);
    else fail('ALIPAY_PAY_CATALOG 必须是非空数组');
  } catch {
    fail('ALIPAY_PAY_CATALOG 不是合法 JSON，会回退默认目录');
  }
} else {
  ok('商品目录用 api/_lib/payCatalog.ts 里的默认值');
}

// ---- 7. 签名串预览（排查 invalid-signature 用） ----------------------------

if (privatePem) {
  const sample = {
    app_id: appId || '2021000000000000',
    method: 'alipay.trade.page.pay',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: signType,
    timestamp: alipayTimestamp(),
    version: '1.0',
    biz_content: JSON.stringify({
      out_trade_no: 'DOCTOR0000000001',
      total_amount: '0.01',
      subject: 'pay-doctor 自检',
      product_code: 'FAST_INSTANT_TRADE_PAY',
    }),
  };
  console.log('\n--- 待签名字符串预览（排查 invalid-signature 时对照用）---');
  console.log(buildSignContent(sample, ['sign']));
}

// ---- 8. 结论 ---------------------------------------------------------------

console.log('\n=== 结论 ===');
if (failures === 0 && warnings === 0) {
  console.log('全部通过。可以起服务点「购买次数」试单了。\n');
} else if (failures === 0) {
  console.log(`${warnings} 条提醒，没有致命问题。本地联调可以继续，上线前把提醒处理掉。\n`);
} else {
  console.log(`${failures} 项致命问题、${warnings} 条提醒。先修致命项，再看提醒。\n`);
}

console.log('接下来：');
console.log('  1. 起服务：pnpm dev');
console.log('  2. 验证后端：curl http://localhost:5173/api/pay?action=catalog');
console.log('  3. 点右上角「购买次数」走一遍下单');
console.log('  4. 完整步骤见 docs/alipay-aipay.md\n');

process.exitCode = failures > 0 ? 1 : 0;
