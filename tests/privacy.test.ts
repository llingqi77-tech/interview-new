import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 隐私与合规静态审计（PRD C3 / C4 / C7 / C9 / 4.1.9）
 * 通过源码扫描验证「原始音视频 0 上传 / 默认不保存 / 无名人形象 / 前端 0 key」。
 */

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

const CLIENT_DIRS = ['components', 'services', 'src', 'data', 'engine'];
const clientFiles = CLIENT_DIRS.flatMap((d) => walk(join(ROOT, d), ['.ts', '.tsx']));

test('C3: 原始视频 0 字节上传——前端无视频上传/发送代码', () => {
  for (const f of clientFiles) {
    const src = readFileSync(f, 'utf8');
    // 不允许出现把 video track / canvas 帧发送到网络的代码
    assert.ok(!/getUserMedia\(\s*\{[^}]*video[^}]*\}[\s\S]{0,200}(fetch|send|upload)/i.test(src), `${f} 疑似上传视频流`);
    assert.ok(!/MediaRecorder[^;]{0,120}video/i.test(src), `${f} 疑似录制视频`);
    assert.ok(!/toBlob\([\s\S]{0,200}(fetch|send)/i.test(src), `${f} 疑似上传 canvas 帧`);
  }
});

test('C4: 原始音频默认不保存——录音仅用于 ASR 提交，不落库', () => {
  const voice = read('services/voiceService.ts');
  // MediaRecorder 只请求音频
  const audioOnly = /getUserMedia\(\s*\{\s*audio:\s*true\s*\}\s*\)/.test(voice);
  assert.ok(audioOnly, 'ASR 录音未限定为 audio only');
  // 音频 blob 不进持久化客户端
  const api = read('src/api.ts');
  assert.ok(!/audio|blob|video/i.test(api.replace(/\/\/.*$/gm, '')), '持久化客户端出现音视频字段');
  // 落库字段仅转写与聚合特征
  for (const field of ['start_ms', 'end_ms', 'confidence', 'stepfun_segment_id', 'speaker']) {
    assert.ok(api.includes(field), `持久化缺少转写字段 ${field}`);
  }
});

test('C3/C4: 视觉特征只上传数值与枚举——无图像/base64/画布采样上传', () => {
  const client = read('src/vision/visionClient.ts');
  const worker = read('src/vision/visionWorker.ts');
  for (const src of [client, worker]) {
    assert.ok(!/base64|toDataURL|toBlob|FileReader/i.test(src), '视觉链路出现图像序列化代码');
    assert.ok(!/getUserMedia/i.test(src), '视觉链路自行申请摄像头（应复用房间内已有流）');
    assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/i.test(src), '视觉链路自行发起上传');
  }
  // 上传 payload 仅由每秒一行的聚合数值/枚举构成
  const api = read('src/api.ts');
  const saveVisual = api.slice(api.indexOf('saveVisualFeatures'));
  assert.ok(/rows: import\('\.\.\/types'\)\.VisualFeatureRow\[\]/.test(saveVisual), 'saveVisualFeatures 未限定为聚合行');
  // 视觉特征行只含数值与情绪枚举（types.ts 结构断言）
  // 视觉特征行结构不含任何图像字段
  const types = read('types.ts');
  const rowType = types.slice(types.indexOf('interface VisualFeatureRow'), types.indexOf('interface VisualStats'));
  for (const banned of ['image', 'blob', 'base64', 'frame', 'bitmap', 'canvas', 'snapshot']) {
    assert.ok(!new RegExp(`\\\\b${banned}\\\\b`, 'i').test(rowType), `VisualFeatureRow 出现图像字段 ${banned}`);
  }
  // 采集仅在同意后启动（同意门控；M7 Phase 1 起逻辑在 SessionController）
  const controller = read('src/session/sessionController.ts');
  assert.ok(/if \(!this\.deps\.consentSaveTranscript\) return;/.test(controller), '视觉采集未做同意门控');
});
test('4.1.9: 同意门控——转写/事件/报告落库均需 consentSaveTranscript', () => {
  const controller = read('src/session/sessionController.ts');
  const saveCalls = controller.match(/if \(this\.deps\.consentSaveTranscript && this\.deps\.sessionId\)/g) ?? [];
  assert.ok(saveCalls.length >= 2, '落库缺少同意门控（消息/事件）');
  const app = read('App.tsx');
  assert.ok(/consent/.test(app), 'App 未传递 consent');
  // 报告保存同样需要同意
  assert.ok(/if \(sessionId && consent\)[\s\S]{0,120}saveReport/.test(app), '报告落库缺少同意门控');
});

test('C7: 形象合规——全部为风格化虚拟形象（dicebear），无真实姓名/肖像', () => {
  const avatars = read('data/avatars.ts');
  const urls = avatars.match(/asset_url: '([^']+)'/g) ?? [];
  assert.equal(urls.length, 13); // 12 候选人预设 + host_01 主持面试官（阵型 A）
  for (const u of urls) {
    assert.ok(/api\.dicebear\.com/.test(u), `非风格化形象来源: ${u}`);
  }
  // 角色名为虚构职称，不含真实名人
  const roleNames = [...read('data/roleCards.ts').matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(roleNames.length >= 12);
  for (const n of roleNames) {
    assert.ok(!/马斯克|乔布斯|马云|马化腾|雷军|爱因斯坦/.test(n), `疑似真实人物: ${n}`);
  }
});

test('C9: 前端 0 key——客户端代码无任何密钥字面量或 key 读取', () => {
  for (const f of clientFiles) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(src), `${f} 含 API key 字面量`);
    assert.ok(!/process\.env\.[A-Z_]*(API_KEY|SECRET|TOKEN|PASSWORD)/.test(src), `${f} 读取服务端密钥环境变量`);
    assert.ok(!/DEEPSEEK_API_KEY|STEPFUN_API_KEY/.test(src), `${f} 引用密钥环境变量名`);
  }
});

test('C9: 服务端 key 仅经 env 读取（api/_lib）', () => {
  const llm = read('api/_lib/llm.ts');
  assert.ok(/process\.env\.DEEPSEEK_API_KEY/.test(llm));
  assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(llm), 'LLM 客户端含硬编码 key');
  const stepfun = read('api/_lib/stepfun.ts');
  assert.ok(/process\.env\.STEPFUN_API_KEY/.test(stepfun));
  assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(stepfun));
});

test('4.1.9: 隐私政策覆盖数据用途/期限/第三方 API（DeepSeek/StepFun）', () => {
  const policy = read('components/PrivacyPolicy.tsx');
  for (const kw of ['DeepSeek', 'StepFun', '保存期限', '删除', '不保存']) {
    assert.ok(policy.includes(kw), `隐私政策缺少「${kw}」说明`);
  }
});

test('C8: 报告规则引擎性能——200 条发言 < 1s（≤30s 预算的规则部分）', async () => {
  const { buildReport } = await import('../engine/reportEngine.ts');
  const transcripts = Array.from({ length: 200 }, (_, i) => ({
    id: String(i),
    senderId: i % 3 === 0 ? 'user' : `ai${i % 3}`,
    senderName: i % 3 === 0 ? '陈明' : `AI${i % 3}`,
    content: i % 3 === 0 ? '首先我认为应该先做用户调研，其次分析竞品，我同意补充一点。' : '我同意，补充一个落地视角。',
    timestamp: 1_000_000 + i * 5000,
    type: 'message' as const,
    startMs: i * 5000,
    endMs: i * 5000 + 4000,
  }));
  const events = Array.from({ length: 20 }, (_, i) => ({
    event_type: 'interrupt' as const,
    actor: `ai${i % 3}`,
    target: 'user',
    timestamp_ms: i * 30_000,
    metadata: { rule: 'user_over_30s' },
  }));
  const t0 = performance.now();
  const report = buildReport({ format: 'lgd', transcripts, events, sessionStartAt: 1_000_000, durationMs: 20 * 60 * 1000 });
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `规则引擎耗时 ${ms.toFixed(0)}ms 超过 1s`);
  assert.ok(report.overall_score > 0);
  assert.ok(report.dimensions.content.evidence.length > 0);
});
