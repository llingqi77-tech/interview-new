import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalize,
  buildReportHash,
  CERT_APP_ID,
  CERT_PAYLOAD_VERSION,
} from '../src/onchain/reportHash.ts';
import { interviewCertificateAbi } from '../src/onchain/abi.ts';
import { MINT_GAS_FALLBACK, MONAD_TESTNET_CHAIN_ID } from '../src/onchain/config.ts';

/**
 * 链上证书（InterviewCertificate / Monad Testnet）测试
 * - canonicalize / buildReportHash 纯函数行为
 * - 前端 ABI 与合约源码的字段级一致性（静态看守，防 ABI 漂移）
 * - UI 接线静态断言（与 ui-wiring.test.ts 同风格）
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const HASH_RE = /^0x[0-9a-f]{64}$/;

// ---------- canonicalize ----------

test('canonicalize: 对象键序无关（递归字典序）', () => {
  const a = canonicalize({ b: 1, a: { d: 2, c: 3 } });
  const b = canonicalize({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":3,"d":2},"b":1}');
});

test('canonicalize: 数组保持原有顺序', () => {
  assert.notEqual(canonicalize([1, 2, 3]), canonicalize([3, 2, 1]));
  assert.equal(canonicalize([{ b: 1, a: 2 }]), '[{"a":2,"b":1}]');
});

test('canonicalize: undefined 丢弃、null 保留、字符串 JSON 转义', () => {
  assert.equal(canonicalize({ a: undefined, b: null }), '{"b":null}');
  assert.equal(canonicalize('说"话"\n'), JSON.stringify('说"话"\n'));
  assert.equal(canonicalize(undefined), 'null');
});

// ---------- buildReportHash ----------

const sampleReport = {
  session_id: 42,
  overall_score: 85,
  dimensions: { content: { score: 80, max: 100, evidence: [], metrics: {} } },
  suggestions: ['多总结他人观点'],
};

const payload = (over: Record<string, unknown> = {}) => ({
  v: CERT_PAYLOAD_VERSION,
  app: CERT_APP_ID,
  minter: '0x1111111111111111111111111111111111111111',
  report: sampleReport,
  ...over,
});

test('buildReportHash: 0x + 64 hex，且确定性', () => {
  const h1 = buildReportHash(payload());
  const h2 = buildReportHash(payload());
  assert.match(h1, HASH_RE);
  assert.equal(h1, h2);
});

test('buildReportHash: minter / report / 版本任一变化 → 哈希变化', () => {
  const base = buildReportHash(payload());
  assert.notEqual(buildReportHash(payload({ minter: '0x2222222222222222222222222222222222222222' })), base);
  assert.notEqual(
    buildReportHash(payload({ report: { ...sampleReport, overall_score: 86 } })),
    base
  );
  assert.notEqual(buildReportHash(payload({ v: 2 as never })), base);
});

test('buildReportHash: 同内容报告不同键序 → 同哈希（验真可复算）', () => {
  const r1 = { a: 1, b: [1, 2], c: { d: 'x' } };
  const r2 = { c: { d: 'x' }, b: [1, 2], a: 1 };
  assert.equal(buildReportHash(payload({ report: r1 })), buildReportHash(payload({ report: r2 })));
});

// ---------- ABI ↔ 合约源码一致性（静态看守） ----------

test('ABI 与合约源码字段级一致（防漂移）', () => {
  const sol = read('contracts/src/InterviewCertificate.sol');

  // 显式函数
  for (const fn of ['mintCertificate', 'verifyReport']) {
    assert.ok(new RegExp(`function ${fn}\\b`).test(sol), `合约缺少函数 ${fn}`);
  }
  // public 状态变量（编译期生成同名 getter）
  for (const v of ['mintPrice', 'certificateOfReport']) {
    assert.ok(new RegExp(`public ${v}\\b`).test(sol), `合约缺少 public 状态 ${v}`);
  }
  assert.ok(/event CertificateMinted\b/.test(sol), '合约缺少 CertificateMinted 事件');

  // ABI 侧形状
  const mint = interviewCertificateAbi.find((e) => e.type === 'function' && e.name === 'mintCertificate');
  assert.ok(mint && 'stateMutability' in mint && mint.stateMutability === 'payable', 'mintCertificate 必须 payable');
  assert.equal(mint?.inputs.length, 1);
  assert.equal(mint?.inputs[0].type, 'bytes32');

  const ev = interviewCertificateAbi.find((e) => e.type === 'event' && e.name === 'CertificateMinted');
  assert.ok(ev && 'inputs' in ev, 'ABI 缺少 CertificateMinted');
  const indexedTypes = (ev as { inputs: readonly { type: string; indexed?: boolean }[] }).inputs
    .filter((i) => i.indexed)
    .map((i) => i.type);
  assert.deepEqual(indexedTypes, ['uint256', 'address', 'bytes32'], '索引器依赖的三个 indexed 字段');

  // soulbound 语义存在
  assert.ok(/SoulboundTransfer/.test(sol), '合约缺少 soulbound 拦截');
});

// ---------- 常量与 UI 接线 ----------

test('gas 兜底值覆盖 forge 实测（113,337）并留 Monad 冷存储溢价', () => {
  // forge test 实测首次铸造 113,337（以太坊定价）；Monad 冷 SSTORE 更贵，兜底必须显著更高
  assert.ok(MINT_GAS_FALLBACK >= 150_000n, `MINT_GAS_FALLBACK 过低: ${MINT_GAS_FALLBACK}`);
  assert.equal(MONAD_TESTNET_CHAIN_ID, 10143);
});

test('接线：ReportView 懒加载铸证卡片并带守卫条件', () => {
  const report = read('components/ReportView.tsx');
  assert.ok(/lazy\(\(\) => import\('\.\/CertificateSection'\)\)/.test(report), '缺少懒加载');
  assert.ok(/isCertConfigured\(\)/.test(report), '缺少配置守卫');
  assert.ok(/wallet\.configured && !wallet\.isLoading/.test(report), '缺少钱包就绪守卫（防 wagmi context 未挂载）');
});

test('接线：CertificateSection 走 estimateGas + ≤10% buffer（Monad 按 limit 计费）', () => {
  const cs = read('components/CertificateSection.tsx');
  assert.ok(/estimateGas/.test(cs), '缺少 gas 估算');
  assert.ok(/est \+ est \/ 10n/.test(cs), 'buffer 必须 ≤10%（gas skill）');
  assert.ok(/MINT_GAS_FALLBACK/.test(cs), '缺少估算失败兜底');
  assert.ok(/chainId: MONAD_TESTNET_CHAIN_ID/.test(cs), '写操作未锁定 testnet');
});
