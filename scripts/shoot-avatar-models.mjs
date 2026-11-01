#!/usr/bin/env node
/**
 * scripts/shoot-avatar-models.mjs — 给「角色 3D 模型检视台」拍照（人工核对的取证工具）
 *
 * 干什么：起一个静态服务器指向 public/，用 headless Chrome 打开
 * public/avatars/3d/viewer.html，等页面自己报「就绪」（window.__ready），
 * 再截屏存到 docs/screenshots/，并把每个角色的加载结果打出来。
 *
 * 用法：
 *   node scripts/shoot-avatar-models.mjs                      # 全部 13 个角色
 *   node scripts/shoot-avatar-models.mjs --id host_01         # 单个角色
 *   node scripts/shoot-avatar-models.mjs --out docs/screenshots/avatar-3d-roles.png
 *   node scripts/shoot-avatar-models.mjs --width 1600 --height 1000 --timeout 120000
 *
 * 依赖：本机 Chrome（CHROME_PATH 可覆盖）+ 仓库里的 ws（CDP 客户端）。WebGL 走 SwiftShader。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const val = (f, d) => {
  const key = f.startsWith('--') ? f : `--${f}`;
  const i = argv.indexOf(key);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const ID = val('id', null);
const WIDTH = Number(val('width', '1600'));
const HEIGHT = Number(val('height', '1000'));
const TIMEOUT_MS = Number(val('timeout', '180000'));
const PORT = Number(val('port', '8775'));
const DEBUG_PORT = Number(val('debug-port', '9333'));
const OUT = path.resolve(ROOT, val('out', path.join('docs', 'screenshots', 'avatar-3d-roles.png')));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Users/Administrator/AppData/Local/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 极简 CDP 客户端 */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.console = [];
    this.errors = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        this.console.push(`[${msg.params.type}] ${text}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params.exceptionDetails?.exception?.description ?? 'unknown error');
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 120000);
    });
  }
}

async function fetchJson(url, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return await res.json();
    } catch {
      /* Chrome 还没起来 */
    }
    await sleep(250);
  }
  throw new Error(`拿不到 ${url}`);
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error('找不到 Chrome/Edge，可用 CHROME_PATH 指定');
    process.exit(2);
  }

  const server = spawn('python', ['-m', 'http.server', String(PORT), '--directory', path.join(ROOT, 'public')], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', () => {});
  await sleep(1000);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-shot-'));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const browser = spawn(
    chrome,
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--mute-audio',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      `--window-size=${WIDTH},${HEIGHT}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  browser.stderr.on('data', () => {});

  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到可用的 page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const cdp = new Cdp(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const url = `http://127.0.0.1:${PORT}/avatars/3d/viewer.html${ID ? `?id=${ID}` : ''}`;
  await cdp.send('Page.navigate', { url });

  const deadline = Date.now() + TIMEOUT_MS;
  let ready = false;
  while (Date.now() < deadline) {
    await sleep(1000);
    try {
      const res = await cdp.send('Runtime.evaluate', {
        expression: 'JSON.stringify({ ready: !!window.__ready, models: window.__avatarModels ?? [] })',
        returnByValue: true,
      });
      const state = JSON.parse(res.result.value);
      if (state.ready) {
        ready = true;
        console.log('页面就绪：', JSON.stringify(state.models));
        break;
      }
    } catch {
      /* 页面还在导航 */
    }
  }
  if (!ready) console.error('等待页面就绪超时（继续截图，可能只加载了一部分）');

  await sleep(1500);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));

  const bytes = fs.statSync(OUT).size;
  console.log(`截图：${path.relative(ROOT, OUT)}（${(bytes / 1024).toFixed(0)}KB，${WIDTH}×${HEIGHT}）`);
  if (cdp.console.length) console.log('页面日志：', cdp.console.slice(-8).join(' | '));
  if (cdp.errors.length) console.log('页面异常：', cdp.errors.slice(-5).join(' | '));

  ws.close();
  browser.kill();
  server.kill();
  process.exit(ready ? 0 : 1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
