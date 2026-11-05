#!/usr/bin/env node
/**
 * scripts/gen-avatar-models.mjs — 13 个角色的「文生 3D」资产产线（Hyper3D / Rodin Gen-2.5）
 *
 * 干什么：data/avatar3dCharacters.ts 里的每个角色 →
 *   生成（文本 → GLB）→ 可选绑骨（Human 骨架 + 待机动画）→ 下载 → public/avatars/3d/<id>.glb
 *   → 写 data/avatarModels.ts 清单（模型 URL、任务 id、规格、实际 credits）。
 *
 * 成本闸门（AGENTS.md / hyper3d skill）：
 *   - 付费动作统一走 scripts/hyper3d.mjs 包装器（它自己也会再拦一道 --yes）；
 *   - 本脚本默认是 dry-run（零 credit）；--run 仍需再加 --yes 才会真提交；
 *   - 提交超时绝不重投：先比钱包，扣过费就用状态文件里的 id 续上，没扣费才允许重试。
 *
 * 断点续跑：每个角色一份 tripo-out/avatars/<id>/state.json，记 generation id / rigging id，
 *           中断后重跑接着走，不会重复计费。
 *
 * 用法：
 *   node scripts/gen-avatar-models.mjs                    # 预演（零 credit），打印 13 个角色的计划
 *   node scripts/gen-avatar-models.mjs --run              # 打印余额与计划后退出（成本闸门，exit 3）
 *   node scripts/gen-avatar-models.mjs --run --yes         # 真跑
 *   node scripts/gen-avatar-models.mjs --run --yes --only host_01
 *   node scripts/gen-avatar-models.mjs --run --yes --skip-rig   # 只生成，不绑骨
 *   node scripts/gen-avatar-models.mjs --json              # 机读输出
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVATAR_3D_CHARACTERS, buildAvatarPrompt } from '../data/avatar3dCharacters.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRAPPER = path.join(ROOT, 'scripts', 'hyper3d.mjs');
const WORK = path.join(ROOT, 'tripo-out', 'avatars');
const PUBLIC_DIR = path.join(ROOT, 'public', 'avatars', '3d');
const MANIFEST = path.join(ROOT, 'data', 'avatarModels.ts');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const JSON_OUT = has('--json');
const RUN = has('--run');
const CONFIRMED = has('--yes');
const ONLY = val('--only', null);
const TIER = val('--tier', 'Gen-2.5-Medium');
const MESH_MODE = val('--mesh-mode', 'Raw');
const QUALITY = Number(val('--quality', '30000'));
const RIG = !has('--skip-rig');
const RIG_ANIMATION = val('--animation', 'Human/standing_idle');
const POLL_INTERVAL_MS = Number(val('--poll-interval', '8000'));
const POLL_TIMEOUT_MS = Number(val('--poll-timeout', '1200000'));

const log = (m) => {
  if (!JSON_OUT) console.log(m);
};

/** 调包装器（付费闸门在包装器里，这里不绕过） */
function runHyper3d(args) {
  const res = spawnSync(process.execPath, [WRAPPER, '--capture', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    env: { ...process.env, HYPER3D_UPDATE_CHECK: '0' },
  });
  if (res.error) throw res.error;
  return { code: res.status ?? 0, out: res.stdout || '', err: res.stderr || '' };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** 递归找第一个命中 key 且像 uuid 的字符串 */
function findUuidDeep(node, keys) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findUuidDeep(item, keys);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of keys) {
    const value = node[key];
    if (typeof value === 'string' && UUID_RE.test(value)) return value;
  }
  for (const value of Object.values(node)) {
    const hit = findUuidDeep(value, keys);
    if (hit) return hit;
  }
  return null;
}

/**
 * 从 CLI 输出里取任务 id。
 * rodin_generate / rodin_generate_rigging 的返回体是 {generation_id, status, display_url}，
 * 所以先按 JSON 字段名找；不是 JSON 再退回正则。
 * 注意：正则里的标签必须用 (?:...) 包起来，否则 'A|B' 的交替会把分组吃掉（曾把 id 解析成 undefined）。
 */
function extractTaskId(text, keys = ['generation_id', 'generationId', 'rigging_id', 'task_id', 'id']) {
  try {
    const found = findUuidDeep(parseJson(text), keys);
    if (found) return found;
  } catch {
    /* 不是 JSON，走正则 */
  }
  const labelled = text.match(new RegExp(`(?:${keys.join('|')})[^\\n]*?(${UUID_RE.source})`, 'i'));
  if (labelled) return labelled[1];
  const all = text.match(UUID_RE.source, 'gi');
  if (all?.length) return all[all.length - 1];
  throw new Error(`没能从输出里解析出任务 id：\n${text.slice(-600)}`);
}

function parseJson(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`输出里没有 JSON：\n${text.slice(-400)}`);
  return JSON.parse(text.slice(start));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 钱包快照（只读）：判断「上一次提交到底扣没扣费」 */
function walletSnapshot() {
  const { code, out } = runHyper3d(['auth', 'status', '--output', 'json']);
  if (code !== 0) return null;
  try {
    const j = parseJson(out);
    const w = j?.wallet ?? {};
    return { balance: w.balance ?? 0, subscription: w.subscription_balance ?? 0 };
  } catch {
    return null;
  }
}

function totalCredits(w) {
  if (!w) return null;
  return (w.balance ?? 0) + (w.subscription ?? 0);
}

/** 下载：先 fetch，失败再 PowerShell（CDN 链接带签名，不能让 shell 再解释一遍） */
async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) throw new Error(`返回体过小（${buf.length}B），多半不是模型文件`);
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
    return { ok: true, bytes: buf.length };
  } catch (error) {
    log(`  [dl] fetch 失败：${error.message}，改用 PowerShell`);
    const ps = `Invoke-WebRequest -Uri '${url}' -OutFile '${tmp}' -UseBasicParsing`;
    const res = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (res.status === 0 && fs.existsSync(tmp)) {
      const size = fs.statSync(tmp).size;
      fs.renameSync(tmp, dest);
      return { ok: true, bytes: size };
    }
    throw new Error(`下载失败：${url}\n${res.stderr || res.stdout}`);
  }
}

/** 从 result JSON 里挑 GLB 与预览图 */
function pickFiles(resultJson) {
  const files = resultJson?.files ?? resultJson?.output?.files ?? resultJson?.result?.files ?? [];
  const out = { glb: null, preview: null, all: [] };
  for (const f of files) {
    const url = f?.url ?? f?.signed_url ?? f?.download_url ?? null;
    if (!url) continue;
    const name = f?.name ?? f?.type ?? '';
    out.all.push({ name, url, type: f?.type ?? null });
    if (!out.glb && /\.glb(\?|$)/i.test(url)) out.glb = url;
    if (!out.preview && /\.(png|jpe?g|webp)(\?|$)/i.test(url)) out.preview = url;
  }
  return out;
}

/** 轮询任务直到完成；超时/失败都不重投 */
async function waitDone(id, label) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let failures = 0;
  while (Date.now() < deadline) {
    const { code, out, err } = runHyper3d(['status', id, '--output', 'json']);
    if (code !== 0) {
      failures += 1;
      log(`  [wait] ${label} status 失败（exit ${code}，连续 ${failures} 次）：${(err || out).trim().slice(-200)}`);
      if (failures >= 5) throw new Error(`${label} status 连续失败 ${failures} 次，放弃等待：${(err || out).trim().slice(-300)}`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    failures = 0;
    let st = null;
    try {
      st = parseJson(out);
    } catch {
      const m = out.match(/"status"\s*:\s*"([^"]+)"/);
      st = m ? { status: m[1] } : null;
    }
    const status = st?.status ?? 'unknown';
    if (['completed', 'succeeded', 'success', 'done'].includes(status)) return st;
    if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      throw new Error(`${label} 任务状态 ${status}：${JSON.stringify(st).slice(0, 300)}`);
    }
    log(`  [wait] ${label} 状态 ${status}…`);
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${label} 轮询超时（${POLL_TIMEOUT_MS / 1000}s），不重投，先查 status/result`);
}

/** 每角色一份状态文件：记下 generation id / rigging id，重跑靠它续上（防重复计费） */
function statePath(id) {
  return path.join(WORK, id, 'state.json');
}
function readState(id) {
  try {
    return JSON.parse(fs.readFileSync(statePath(id), 'utf8'));
  } catch {
    return {};
  }
}
function writeState(id, patch) {
  const p = statePath(id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify({ ...readState(id), ...patch }, null, 2)}\n`);
}

const TIMEOUT_RE = /timed out|timeout|aborted|-32001/i;

/**
 * 提交生成。超时不直接重投：先看钱包 ——
 *   余额没变 → 没扣费，任务多半没建出来，可以安全重试；
 *   余额变了 → 任务多半已经建了，不许重投。
 */
function submitGenerate(prompt, id) {
  const before = walletSnapshot();
  const { code, out, err } = runHyper3d([
    'generate',
    '--prompt',
    prompt,
    '--tier',
    TIER,
    '--mesh-mode',
    MESH_MODE,
    '--quality',
    String(QUALITY),
    '--format',
    'glb',
    '--yes',
  ]);
  if (code === 0) {
    const genId = extractTaskId(out);
    return { genId, before, after: walletSnapshot() };
  }
  const text = `${err}\n${out}`;
  const after = walletSnapshot();
  const billed =
    before && after && (before.balance !== after.balance || before.subscription !== after.subscription);
  if (billed) {
    throw new Error(`generate 超时但钱包已扣费（${JSON.stringify(before)}→${JSON.stringify(after)}），不重投：${text.trim().slice(-300)}`);
  }
  if (!TIMEOUT_RE.test(text)) {
    throw new Error(`generate 失败（exit ${code}）：${text.trim().slice(-400)}`);
  }
  throw new Error(`generate 提交超时且未扣费：${text.trim().slice(-300)}`);
}

/** 生成 → （可选）绑骨 → 下载 → 落地 */
async function produce(char) {
  const id = char.id;
  const dir = path.join(WORK, id);
  const rawGlb = path.join(dir, 'raw.glb');
  const finalGlb = path.join(dir, 'final.glb');
  const destGlb = path.join(PUBLIC_DIR, `${id}.glb`);
  const destPreview = path.join(PUBLIC_DIR, `${id}.png`);
  const st = readState(id);
  const prompt = buildAvatarPrompt(char);

  const creditsBefore = totalCredits(walletSnapshot());

  // —— 1. 生成 ——
  let genId = st.generationId;
  if (!genId) {
    const sub = submitGenerate(prompt, id);
    genId = sub.genId;
    writeState(id, { generationId: genId, prompt, name: char.name, tier: TIER, meshMode: MESH_MODE, quality: QUALITY });
    log(`  [gen] ${id} generation ${genId}`);
  } else {
    log(`  [gen] ${id} 复用已有 generation ${genId}`);
  }
  await waitDone(genId, `${id} 生成`);

  // —— 2. 下载原始 GLB ——
  if (!fs.existsSync(rawGlb)) {
    const res = runHyper3d(['result', genId, '--output', 'json']);
    if (res.code !== 0) throw new Error(`result 失败（exit ${res.code}）：${(res.err || res.out).trim().slice(-300)}`);
    const files = pickFiles(parseJson(res.out));
    if (!files.glb) throw new Error(`result 里没有 glb：${JSON.stringify(files.all).slice(0, 300)}`);
    const dl = await download(files.glb, rawGlb);
    log(`  [dl] ${id} raw.glb ${dl.bytes}B`);
    if (files.preview && !fs.existsSync(destPreview)) {
      const p = await download(files.preview, destPreview);
      log(`  [dl] ${id} preview ${p.bytes}B`);
    }
  }

  // —— 3. 绑骨（可选）——
  let rigId = st.riggingId ?? null;
  let animation = null;
  if (RIG) {
    animation = RIG_ANIMATION;
    if (!rigId) {
      const { code, out, err } = runHyper3d([
        'rigging',
        genId,
        '--bone-template',
        'human',
        '--animation-preset',
        RIG_ANIMATION,
        '--format',
        'glb',
        '--yes',
      ]);
      if (code !== 0) {
        throw new Error(`rigging 失败（exit ${code}）：${(`${err}\n${out}`).trim().slice(-400)}`);
      }
      rigId = extractTaskId(out, ['rigging_id', 'generation_id', 'task_id', 'id']);
      writeState(id, { riggingId: rigId, animation });
      log(`  [rig] ${id} rigging ${rigId}`);
    } else {
      log(`  [rig] ${id} 复用已有 rigging ${rigId}`);
    }
    await waitDone(rigId, `${id} 绑骨`);
    const res = runHyper3d(['result', rigId, '--output', 'json']);
    if (res.code !== 0) throw new Error(`result(rig) 失败（exit ${res.code}）：${(res.err || res.out).trim().slice(-300)}`);
    const files = pickFiles(parseJson(res.out));
    if (!files.glb) throw new Error(`rigging result 里没有 glb：${JSON.stringify(files.all).slice(0, 300)}`);
    const dl = await download(files.glb, finalGlb);
    log(`  [dl] ${id} rigged.glb ${dl.bytes}B`);
  } else if (fs.existsSync(rawGlb)) {
    fs.copyFileSync(rawGlb, finalGlb);
  }

  // —— 4. 落地 ——
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  const source = RIG ? finalGlb : rawGlb;
  if (!fs.existsSync(source)) throw new Error(`缺成品文件：${source}`);
  fs.copyFileSync(source, destGlb);
  let bytes = fs.statSync(destGlb).size;
  // 贴图 PNG → WebP（EXT_texture_webp）：9MB → 2.3MB，13 个角色进仓库才不撑爆
  if (!has('--no-optimize')) {
    const opt = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'optimize-avatar-glb.mjs'), '--run', '--file', destGlb, '--no-backup'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    if (opt.status === 0) {
      bytes = fs.statSync(destGlb).size;
      log(`  [opt] ${id} 贴图转 WebP → ${(bytes / 1048576).toFixed(2)}MB`);
    } else {
      log(`  [opt] ${id} 优化失败（保留原图）：${(opt.stderr || '').trim().slice(-200)}`);
    }
  }

  const creditsAfter = totalCredits(walletSnapshot());
  writeState(id, {
    modelUrl: `/avatars/3d/${id}.glb`,
    bytes,
    creditsSpent:
      creditsBefore !== null && creditsAfter !== null ? Number((creditsBefore - creditsAfter).toFixed(3)) : null,
    finishedAt: new Date().toISOString(),
  });
  log(`  [out] ${id} → public/avatars/3d/${id}.glb（${bytes}B）`);
  return {
    id,
    name: char.name,
    tier: TIER,
    meshMode: MESH_MODE,
    quality: QUALITY,
    generationId: genId,
    riggingId: rigId,
    animation,
    bytes,
    creditsSpent: creditsBefore !== null && creditsAfter !== null ? Number((creditsBefore - creditsAfter).toFixed(3)) : null,
    modelUrl: `/avatars/3d/${id}.glb`,
    previewUrl: fs.existsSync(destPreview) ? `/avatars/3d/${id}.png` : null,
  };
}

/** 写清单 data/avatarModels.ts（生成物，别手改） */
function writeManifest(entries) {
  const rows = entries
    .map(
      (e) => `  '${e.id}': {
    id: '${e.id}',
    name: '${e.name}',
    model_url: '/avatars/3d/${e.id}.glb',
    preview_url: ${e.previewUrl ? `'/avatars/3d/${e.id}.png'` : 'null'},
    generator: 'hyper3d-rodin-gen2.5',
    tier: '${e.tier ?? TIER}',
    mesh_mode: '${e.meshMode ?? MESH_MODE}',
    quality: ${e.quality ?? QUALITY},
    animation: ${e.animation ? `'${e.animation}'` : 'null'},
    generation_id: '${e.generationId}',
    rigging_id: ${e.riggingId ? `'${e.riggingId}'` : 'null'},
    bytes: ${e.bytes},
    credits: ${e.creditsSpent ?? 'null'},
    generated_at: '${e.finishedAt ?? new Date().toISOString()}',
  },`,
    )
    .join('\n');
  const content = `/**
 * data/avatarModels.ts —— 角色 3D 模型清单（**生成物，别手改**）
 *
 * 由 scripts/gen-avatar-models.mjs 写入：每个角色一份文生 3D 模型（GLB）。
 * 角色定义与美术设定见 data/avatar3dCharacters.ts。
 * 生成命令：node scripts/gen-avatar-models.mjs --run --yes
 *
 * credits 字段 = 该角色处理期间的钱包净变化。**并行跑多个角色时钱包是共享的，
 * 这个值会互相串账**（可能大于真实成本）；真实单角色成本 = 1 credit
 * （生成 0.5 + 绑骨 0.5），整批总消耗看钱包前后的差额。
 */

import type { AvatarModelEntry } from '../types';

export const AVATAR_MODELS: Record<string, AvatarModelEntry> = {
${rows}
};

/** 按 AvatarPreset.id 取 3D 模型条目 */
export function findAvatarModel(id: string): AvatarModelEntry | undefined {
  return AVATAR_MODELS[id];
}
`;
  fs.writeFileSync(MANIFEST, content);
  log(`  [manifest] data/avatarModels.ts（${entries.length} 条）`);
}

const ONLY_IDS = val('--ids', null)
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const targets = AVATAR_3D_CHARACTERS.filter(
  (c) => (!ONLY || c.id === ONLY) && (!ONLY_IDS || ONLY_IDS.includes(c.id)),
);

/* 只重建清单（从各角色的 state.json 汇总，零 credit）——必须在 dry-run 分支之前 */
if (has('--manifest')) {
  writeManifest(collectEntries());
  process.exit(0);
}

if (!RUN) {
  const wallet = walletSnapshot();
  const rows = targets.map((c) => {
    const st = readState(c.id);
    return {
      id: c.id,
      name: c.name,
      promptChars: buildAvatarPrompt(c).length,
      billableCalls: st.generationId ? (RIG && !st.riggingId ? 1 : 0) : RIG ? 2 : 1,
      done: Boolean(st.modelUrl),
      dest: path.relative(ROOT, path.join(PUBLIC_DIR, `${c.id}.glb`)).split(path.sep).join('/'),
    };
  });
  if (JSON_OUT) {
    console.log(JSON.stringify({ dryRun: true, tier: TIER, quality: QUALITY, rig: RIG, wallet, rows }, null, 2));
  } else {
    log(`档位 ${TIER} · mesh=${MESH_MODE} · quality=${QUALITY} · 绑骨 ${RIG ? '开（' + RIG_ANIMATION + '）' : '关'} · DRY-RUN（零 credit）`);
    log(`钱包：${wallet ? `余额 ${wallet.balance} + 订阅 ${wallet.subscription} = ${totalCredits(wallet)} credits` : '读不到'}`);
    log('');
    log('角色 id          名称        提示词  付费调用  状态    落地路径');
    for (const r of rows) {
      log(
        `${r.id.padEnd(16)}${r.name.padEnd(11)}${String(r.promptChars).padEnd(7)}${String(r.billableCalls).padEnd(9)}${(r.done ? '已完成' : '待生成').padEnd(8)}${r.dest}`,
      );
    }
    log('');
    const calls = rows.reduce((s, r) => s + r.billableCalls, 0);
    log(`合计 ${targets.length} 个角色 · ${calls} 次付费调用（单次实测 0.5 credits 量级，以实际扣费为准）`);
  }
  process.exit(0);
}

if (!CONFIRMED) {
  const wallet = walletSnapshot();
  const calls = targets.filter((c) => !readState(c.id).generationId).length * (RIG ? 2 : 1);
  console.error(
    [
      `[gen-avatar-models] 付费动作被拦下。`,
      `  钱包：${wallet ? `余额 ${wallet.balance} + 订阅 ${wallet.subscription} = ${totalCredits(wallet)} credits` : '读不到'}`,
      `  将提交：${targets.length} 个角色 × ${RIG ? 2 : 1} 次付费调用 ≈ ${calls} 次`,
      `  档位：${TIER} · mesh=${MESH_MODE} · quality=${QUALITY} · 绑骨 ${RIG ? RIG_ANIMATION : '关'}`,
      `  同意后加 --yes 重跑同一条命令。`,
    ].join('\n'),
  );
  process.exit(3);
}

/** 汇总各角色 state.json 里的成品信息 */
function collectEntries(results = []) {
  const merged = new Map();
  for (const r of results) merged.set(r.id, r);
  for (const c of AVATAR_3D_CHARACTERS) {
    const st = readState(c.id);
    if (!st.modelUrl || merged.has(c.id)) continue;
    merged.set(c.id, {
      id: c.id,
      name: c.name,
      tier: st.tier,
      meshMode: st.meshMode,
      quality: st.quality,
      generationId: st.generationId,
      riggingId: st.riggingId ?? null,
      animation: st.animation ?? null,
      bytes: st.bytes,
      creditsSpent: st.creditsSpent ?? null,
      finishedAt: st.finishedAt,
      previewUrl: fs.existsSync(path.join(PUBLIC_DIR, `${c.id}.png`)) ? `/avatars/3d/${c.id}.png` : null,
    });
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}



const results = [];
for (const char of targets) {
  log(`[run] ${char.id}（${char.name}）…`);
  try {
    results.push(await produce(char));
  } catch (error) {
    console.error(`[run] ${char.id} 失败：${error.message}`);
    if (JSON_OUT) console.log(JSON.stringify({ error: error.message, done: results }, null, 2));
    process.exitCode = 1;
    break;
  }
}

if (results.length && !has('--no-manifest')) {
  writeManifest(collectEntries(results));
}

if (JSON_OUT) console.log(JSON.stringify({ dryRun: false, results }, null, 2));
