#!/usr/bin/env node
/**
 * scripts/hyper3d.mjs — Hyper3D CLI 统一入口（agent / 人工共用）
 *
 * 为什么有这层（和 dingdong-island 同源，本仓库另起一份）：
 *   1. 非 TTY 下每天一次的更新检查会污染 stdout；
 *   2. CLI 没有 --dry-run，付费动作（generate / agentic / rigging / bang）没有成本闸门；
 *   3. CLI 自带的 refresh 流程会带 resource/scope 参数，服务端回 invalid_target
 *      → 令牌过期后 CLI 直接超时。这里自己用最小参数集换令牌。
 *
 * 用法：
 *   node scripts/hyper3d.mjs balance                     # 余额 + 工作区（只读）
 *   node scripts/hyper3d.mjs auth status --output json    # 透传
 *   node scripts/hyper3d.mjs generate --prompt "..." --yes # 付费动作必须 --yes
 *   node scripts/hyper3d.mjs poll <id> --timeout 300
 *   node scripts/hyper3d.mjs status|result <id>
 *
 * 退出码：0 成功 / 1 CLI 自身失败 / 2 未登录或凭据失效 / 3 付费动作缺确认
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 消耗 credits 的动作：没有 --yes 一律不提交 */
const BILLABLE = new Set(['generate', 'agentic', 'rigging', 'bang']);
/** 显式确认开关，会在透传前剥离 */
const CONFIRM_FLAGS = new Set(['--yes', '--confirm-billable', '-y']);

const TOKEN_ENDPOINT = 'https://api.hyper3d.com/api/grant/oauth/oauth2/token';
const CLI_CLIENT_ID = 'https://hyper3d.ai/oauth_cimd/cli.json';
const SCOPES = 'rodin:generate rodin:read account:read offline_access';

function configDir() {
  return process.env.HYPER3D_CONFIG_DIR || path.join(os.homedir(), '.hyper3d');
}

function candidateCliJs() {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  return [
    process.env.HYPER3D_CLI_JS,
    path.join(appData, 'npm', 'node_modules', '@hyper3d', 'cli', 'dist', 'index.js'),
    path.join(home, '.npm-global', 'lib', 'node_modules', '@hyper3d', 'cli', 'dist', 'index.js'),
    '/usr/local/lib/node_modules/@hyper3d/cli/dist/index.js',
    '/usr/lib/node_modules/@hyper3d/cli/dist/index.js',
  ].filter(Boolean);
}

function resolveRunner() {
  for (const js of candidateCliJs()) {
    if (existsSync(js)) return { kind: 'node', js };
  }
  const probe = spawnSync('hyper3d', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  if (!probe.error && probe.status === 0) return { kind: 'bin' };
  return null;
}

const runner = resolveRunner();
if (!runner) {
  process.stderr.write('hyper3d CLI 未找到。安装：npm i -g @hyper3d/cli@latest\n');
  process.exit(1);
}

/**
 * 直连优先：api.hyper3d.com 本机直连可达，走 10808 代理反而会卡死。
 * 只有显式给 HYPER3D_PROXY 才注入代理变量。
 */
function childEnv() {
  const env = { ...process.env, HYPER3D_UPDATE_CHECK: process.env.HYPER3D_UPDATE_CHECK ?? '0' };
  if (process.env.HYPER3D_PROXY) {
    env.HTTPS_PROXY = process.env.HYPER3D_PROXY;
    env.HTTP_PROXY = process.env.HYPER3D_PROXY;
    env.NODE_USE_ENV_PROXY = '1';
  } else {
    delete env.HTTPS_PROXY;
    delete env.HTTP_PROXY;
    delete env.https_proxy;
    delete env.http_proxy;
    delete env.NODE_USE_ENV_PROXY;
  }
  return env;
}

function runCli(args, { capture = false } = {}) {
  const env = childEnv();
  const opts = { env, encoding: 'utf8' };
  if (runner.kind === 'node') {
    return execFileSync(process.execPath, [runner.js, ...args], {
      ...opts,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
  }
  return spawnSync('hyper3d', args, {
    ...opts,
    shell: process.platform === 'win32',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

/* ------------------------------------------------------------------ *
 * 令牌自愈：CLI 自己的 refresh 会回 invalid_target，这里用最小参数集换
 * ------------------------------------------------------------------ */

function credentialFiles() {
  const dir = configDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
}

async function refreshIfNeeded() {
  for (const file of credentialFiles()) {
    let store;
    try {
      store = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!store.tokens?.refresh_token) continue;
    const valid = store.expiresAt && store.expiresAt > Date.now() + 60_000;
    if (valid) continue;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: store.clientId || CLI_CLIENT_ID,
      refresh_token: store.tokens.refresh_token,
    });
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    if (!res.ok) {
      process.stderr.write(`[hyper3d] 令牌刷新失败 HTTP ${res.status}: ${text.slice(0, 200)}\n`);
      continue;
    }
    const data = JSON.parse(text);
    store.tokens = {
      access_token: data.access_token,
      token_type: data.token_type ?? 'Bearer',
      expires_in: data.expires_in,
      scope: data.scope ?? SCOPES,
      refresh_token: data.refresh_token ?? store.tokens.refresh_token,
    };
    store.expiresAt = Date.now() + Number(data.expires_in ?? 3600) * 1000;
    store.clientId = store.clientId || CLI_CLIENT_ID;
    writeFileSync(file, JSON.stringify(store, null, 2));
    process.stderr.write(`[hyper3d] 令牌已刷新，有效期至 ${new Date(store.expiresAt).toISOString()}\n`);
  }
}

function accountJson() {
  try {
    const raw = runCli(['auth', 'status', '--output', 'json'], { capture: true });
    const start = raw.indexOf('{');
    if (start < 0) throw new Error(`无法解析 auth status 输出：${String(raw).slice(0, 200)}`);
    return JSON.parse(raw.slice(start));
  } catch (error) {
    const text = `${error.stderr ?? ''}${error.stdout ?? ''}${error.message ?? ''}`;
    if (/authenticated|access denied|401|403/i.test(text)) {
      process.stderr.write('Hyper3D 未登录或凭据失效。运行：hyper3d auth login（需要浏览器授权）。\n');
      process.exit(2);
    }
    throw error;
  }
}

function printBalance(account) {
  const wallet = account?.wallet ?? {};
  const who = account?.user?.username ?? account?.user?.uuid ?? 'unknown';
  const bal = wallet.balance ?? 0;
  const frozen = wallet.frozen ?? 0;
  const sub = wallet.subscription_balance ?? 0;
  process.stderr.write(
    `[hyper3d] 工作区 ${wallet.type ?? 'unknown'}：账号 ${who} ` +
      `余额 ${bal} credits${sub ? `（订阅 ${sub}）` : ''}${frozen ? `，冻结 ${frozen}` : ''}\n`,
  );
}

function stripConfirmFlags(args) {
  const out = [];
  const stripped = [];
  for (const arg of args) {
    if (CONFIRM_FLAGS.has(arg)) stripped.push(arg);
    else out.push(arg);
  }
  return { args: out, confirmed: stripped.length > 0 };
}

function ensureJsonOutput(args) {
  if (!args.includes('--json')) return args;
  return args.filter((a) => a !== '--json').concat('--output', 'json');
}

const argv = process.argv.slice(2);
const command = argv[0];
if (!command || command === '-h' || command === '--help' || command === 'help') {
  process.stdout.write(
    [
      'hyper3d 统一入口（项目封装 @hyper3d/cli）',
      '',
      '  node scripts/hyper3d.mjs balance                     余额 + 工作区（只读）',
      "  node scripts/hyper3d.mjs auth status --output json   透传 CLI",
      '  node scripts/hyper3d.mjs generate --prompt "..." --yes',
      '  node scripts/hyper3d.mjs poll <id> --timeout 300',
      '',
      '付费动作（generate / agentic / rigging / bang）必须带 --yes，',
      '不带则只打印余额与将要提交的参数，然后以退出码 3 结束。',
      '其余参数一律原样透传给 hyper3d，--json 等价于 --output json。',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

if (command === 'balance') {
  await refreshIfNeeded();
  printBalance(accountJson());
  process.exit(0);
}

const { args, confirmed } = stripConfirmFlags(argv);

/* --capture 模式：把 CLI 的 stdout 原样转出来（stdout 只有 JSON，方便脚本解析），
   stderr 仍走 stderr（余额提示、告警都留在那儿）。 */
const CAPTURE = args[0] === '--capture';
if (CAPTURE) args.shift();

if (BILLABLE.has(command)) {
  await refreshIfNeeded();
  const account = accountJson();
  printBalance(account);
  if (!confirmed) {
    process.stderr.write(
      [
        `[hyper3d] 付费动作被拦下：hyper3d ${args.join(' ')}`,
        '                提交前需要 operator 明确同意（credits 会真实扣除）。',
        '                同意后：在参数里加 --yes 重跑同一条命令。',
        '',
      ].join('\n'),
    );
    process.exit(3);
  }
}

try {
  if (CAPTURE) {
    const raw = runCli(ensureJsonOutput(args), { capture: true });
    process.stdout.write(typeof raw === 'string' ? raw : (raw.stdout ?? ''));
    if (typeof raw !== 'string' && raw.stderr) process.stderr.write(raw.stderr);
    if (typeof raw !== 'string' && raw.status) process.exit(raw.status);
  } else {
    runCli(ensureJsonOutput(args));
  }
} catch (error) {
  process.exit(error.status ?? 1);
}
