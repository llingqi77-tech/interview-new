#!/usr/bin/env node
/**
 * scripts/optimize-avatar-glb.mjs — 把 GLB 里的 PNG 贴图换成 WebP（EXT_texture_webp）
 *
 * ## 为什么要做
 *
 * Rodin 出来的角色模型贴图是 2048² PNG，三张就占 6.8MB —— 一个角色 9.5MB，
 * 13 个角色进仓库就是 124MB，网页端首屏也扛不住。
 * 同一张图转 WebP 后只有 60–80KB（实测 2.3MB → 66KB），模型体积从 9.5MB 掉到 ~2.8MB。
 *
 * ## 为什么不用 gltf-transform
 *
 * `gltf-transform webp` 在 hyper3d / tripo 两个来源的资产上都报
 * "colourspace: parameter space not set"（实测）——它们的贴图元数据缺 colourspace 标记。
 * 所以贴图走本脚本，几何不动。
 *
 * ## 编码器
 *
 * 优先用本机 Python + Pillow（`PIL.Image.save(..., 'WEBP')`）；没有 Pillow 就退到 ffmpeg；
 * 都没有就原样保留 PNG（不报错，脚本给出告警）。
 *
 * ## 产物格式
 *
 * 走 glTF 的 `EXT_texture_webp` 扩展：
 *   - images[i].mimeType 改成 image/webp，bufferView 里放 WebP 字节；
 *   - textures[i].extensions.EXT_texture_webp = { source: i }（与基础 source 同索引）；
 *   - extensionsUsed / extensionsRequired 补上 EXT_texture_webp。
 *
 * 用法：
 *   node scripts/optimize-avatar-glb.mjs --dry-run --dir public/avatars/3d   # 预演
 *   node scripts/optimize-avatar-glb.mjs --run --file public/avatars/3d/host_01.glb
 *   node scripts/optimize-avatar-glb.mjs --run --dir public/avatars/3d --json
 *
 * 退出码：0 全部成功；1 有件失败（保留原文件，不落地半成品）
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const JSON_OUT = has('--json');
const DRY = has('--dry-run') || !has('--run');
const QUALITY = Number(val('--quality', '90'));
const FILE = val('--file', null);
const DIR = val('--dir', null);
const BACKUP = !has('--no-backup');

const log = (m) => {
  if (!JSON_OUT) console.log(m);
};

/* ------------------------------------------------------------------ *
 * GLB 读写
 * ------------------------------------------------------------------ */

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`不是 GLB：${file}`);
  const version = buf.readUInt32LE(4);
  const total = buf.readUInt32LE(8);
  let off = 12;
  let json = null;
  let bin = null;
  while (off + 8 <= Math.min(total, buf.length)) {
    const len = buf.readUInt32LE(off);
    const type = buf.toString('ascii', off + 4, off + 8).replace(/\0+$/, '');
    if (type === 'JSON') json = JSON.parse(buf.toString('utf8', off + 8, off + 8 + len));
    if (type === 'BIN') bin = buf.subarray(off + 8, off + 8 + len);
    off += 8 + len;
  }
  if (!json) throw new Error(`GLB 里没有 JSON 块：${file}`);
  return { buf, version, json, bin };
}

function writeGlb(file, json, bin) {
  const jsonText = JSON.stringify(json);
  const jsonRaw = Buffer.from(jsonText, 'utf8');
  const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0x00)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.write('JSON', 4, 'ascii');
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.write('BIN\0', 4, 'ascii');
  fs.writeFileSync(file, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]));
}

/* ------------------------------------------------------------------ *
 * PNG → WebP 编码器（Python+Pillow → ffmpeg → 放弃）
 * ------------------------------------------------------------------ */

function encodeWebp(pngPath, webpPath) {
  const py = spawnSync(
    'python',
    [
      '-c',
      'from PIL import Image; import sys; im=Image.open(sys.argv[1]); im.convert("RGBA").save(sys.argv[2], "WEBP", quality=int(sys.argv[3]), method=4)',
      pngPath,
      webpPath,
      String(QUALITY),
    ],
    { encoding: 'utf8' },
  );
  if (py.status === 0 && fs.existsSync(webpPath) && fs.statSync(webpPath).size > 0) {
    return { ok: true, via: 'pillow' };
  }
  const ff = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', pngPath, '-c:v', 'libwebp', '-quality', String(QUALITY), webpPath],
    { encoding: 'utf8' },
  );
  if (ff.status === 0 && fs.existsSync(webpPath) && fs.statSync(webpPath).size > 0) {
    return { ok: true, via: 'ffmpeg' };
  }
  return { ok: false, via: null, pyErr: (py.stderr || '').slice(-200), ffErr: (ff.stderr || '').slice(-200) };
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

function optimizeFile(file) {
  const { json, bin } = readGlb(file);
  const images = json.images ?? [];
  const pngIndexes = images
    .map((im, i) => ({ im, i }))
    .filter(({ im }) => im.mimeType === 'image/png' && im.bufferView !== undefined)
    .map(({ i }) => i);

  if (pngIndexes.length === 0) {
    return { file, skipped: true, reason: '没有 PNG 贴图', bytes: fs.statSync(file).size };
  }

  // 收集要替换的 bufferView（按原 byteOffset 排序，重排 BIN 时保持相对顺序）
  const views = json.bufferViews.map((bv, i) => ({ ...bv, index: i }));
  const ordered = [...views].sort((a, b) => (a.byteOffset ?? 0) - (b.byteOffset ?? 0));

  const tmpDir = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'glb-webp-'));
  const replacements = new Map(); // bufferView index -> { bytes, mimeType }
  let converted = 0;

  for (const i of pngIndexes) {
    const im = images[i];
    const bv = views[im.bufferView];
    const src = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    const pngPath = path.join(tmpDir, `${i}.png`);
    const webpPath = path.join(tmpDir, `${i}.webp`);
    fs.writeFileSync(pngPath, src);
    const enc = encodeWebp(pngPath, webpPath);
    if (!enc.ok) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      throw new Error(`WebP 编码失败（Pillow 与 ffmpeg 都不行）：${enc.pyErr} ${enc.ffErr}`);
    }
    replacements.set(im.bufferView, { bytes: fs.readFileSync(webpPath), mimeType: 'image/webp', via: enc.via });
    converted += 1;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // 重建 BIN：按原顺序拼接每个 bufferView，图片段换成 WebP
  // 重建 BIN：按原顺序拼接每个 bufferView，图片段换成 WebP
  // 每段起点对齐到 4 字节（glTF 对 bufferView/accessor 的对齐要求）
  const parts = [];
  const newOffsets = new Map();
  let cursorLen = 0;
  for (const bv of ordered) {
    const off = bv.byteOffset ?? 0;
    const rep = replacements.get(bv.index);
    const bytes = rep ? rep.bytes : bin.subarray(off, off + bv.byteLength);
    const pad = (4 - (cursorLen % 4)) % 4;
    if (pad) {
      parts.push(Buffer.alloc(pad, 0x00));
      cursorLen += pad;
    }
    newOffsets.set(bv.index, cursorLen);
    parts.push(bytes);
    cursorLen += bytes.length;
  }
  const newBin = Buffer.concat(parts);

  // 改 JSON
  const newJson = JSON.parse(JSON.stringify(json));
  newJson.bufferViews.forEach((bv, i) => {
    bv.byteOffset = newOffsets.get(i);
  });
  for (const i of pngIndexes) {
    newJson.images[i].mimeType = 'image/webp';
  }
  newJson.extensionsUsed = new Set([...(newJson.extensionsUsed ?? []), 'EXT_texture_webp']);
  newJson.extensionsRequired = new Set([...(newJson.extensionsRequired ?? []), 'EXT_texture_webp']);
  newJson.extensionsUsed = [...newJson.extensionsUsed];
  newJson.extensionsRequired = [...newJson.extensionsRequired];
  newJson.textures = (newJson.textures ?? []).map((tex, i) => ({
    ...tex,
    extensions: { ...(tex.extensions ?? {}), EXT_texture_webp: { source: i } },
  }));

  const before = fs.statSync(file).size;
  if (DRY) {
    return { file, skipped: false, converted, before, after: before, dryRun: true };
  }
  if (BACKUP) fs.copyFileSync(file, `${file}.orig`);
  writeGlb(file, newJson, newBin);
  const after = fs.statSync(file).size;
  return { file, skipped: false, converted, before, after, saved: before - after };
}

function collectFiles() {
  if (FILE) return [path.resolve(FILE)];
  if (DIR) {
    const dir = path.resolve(DIR);
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.glb'))
      .map((f) => path.join(dir, f));
  }
  process.stderr.write('需要 --file <path.glb> 或 --dir <目录>\n');
  process.exit(2);
  return [];
}

const files = collectFiles();
const results = [];
let failed = false;
for (const file of files) {
  try {
    const r = optimizeFile(file);
    results.push(r);
    if (!r.skipped) {
      log(
        `${r.dryRun ? '[dry] ' : '[run] '}${path.basename(file)}  ${r.converted} 张 PNG → WebP  ` +
          `${(r.before / 1048576).toFixed(2)}MB → ${(r.after / 1048576).toFixed(2)}MB`,
      );
    } else {
      log(`[skip] ${path.basename(file)}：${r.reason}`);
    }
  } catch (error) {
    failed = true;
    results.push({ file, error: error.message });
    process.stderr.write(`[fail] ${path.basename(file)}：${error.message}\n`);
  }
}

if (JSON_OUT) console.log(JSON.stringify({ dryRun: DRY, quality: QUALITY, results }, null, 2));
process.exit(failed ? 1 : 0);
