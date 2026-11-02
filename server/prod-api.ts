/**
 * 生产 HTTP 服务器（ECS / Docker / 任意 Node 24 环境）
 *
 * 为什么存在：api/ 下 12 个 handler 用的是 Vercel 的 (req, res) 签名，平台负责路由、
 * body 解析、query 注入，以及 response 上的 status/json/send 扩展。离开 Vercel 之后
 * 这些都得自己补，否则 handler 里 request.query 是 undefined、response.json 直接不是函数。
 *
 * 与 server/local-api.ts 的关系：同一套路由表和 shim 语义，差别只有两点——
 *   1. 这里用原生 import() 加载 .ts（Node 24 内置类型擦除，实测可用），不依赖 Vite；
 *   2. 这里额外接管 /api/realtime 的 WebSocket upgrade（Vercel 跑不了 WS，本地 dev 也接管）。
 * 路由表两处必须同步维护，改一处就要改另一处。
 *
 * 启动：node server/prod-api.ts
 * 环境变量：PORT（默认 3000）、HOST（默认 0.0.0.0）、SERVE_STATIC=0 关闭静态托管
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { handleRealtimeUpgrade, isRealtimeUpgradePath } from './realtime-proxy.ts';

type ApiHandler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

interface VercelRes extends ServerResponse {
  status: (code: number) => VercelRes;
  json: (data: unknown) => VercelRes;
  send: (data: unknown) => VercelRes;
}

const ROOT = resolve(process.cwd());
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const SERVE_STATIC = process.env.SERVE_STATIC !== '0';

/** 与 server/local-api.ts 的 STATIC_ROUTES 保持一致 */
const STATIC_ROUTES: Record<string, string> = {
  '/api/llm': 'api/llm.ts',
  '/api/session': 'api/session.ts',
  '/api/message': 'api/message.ts',
  '/api/feedback': 'api/feedback.ts',
  '/api/events': 'api/events.ts',
  '/api/avatars': 'api/avatars.ts',
  '/api/avatars/presets': 'api/avatars.ts',
  '/api/tts': 'api/tts.ts',
  '/api/asr': 'api/asr.ts',
  '/api/tts-token': 'api/tts.ts',
  '/api/asr-token': 'api/asr.ts',
  '/api/realtime-token': 'api/realtime-token.ts',
  '/api/pay': 'api/pay.ts',
};

/** 与 server/local-api.ts 的 DYNAMIC_ROUTES 保持一致；聚合路由自己解析 id/action */
const DYNAMIC_ROUTES: { re: RegExp; file: string }[] = [
  { re: /^\/api\/sessions(?:\/[^/]+)?(?:\/(?:analyze|report|visual))?\/?$/, file: 'api/sessions.ts' },
];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.binarypb': 'application/octet-stream',
  '.data': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const moduleCache = new Map<string, ApiHandler>();

/** 动态 import 一个 handler 模块并缓存；Node 24 直接吃 .ts（类型擦除） */
async function loadHandler(file: string): Promise<ApiHandler> {
  const cached = moduleCache.get(file);
  if (cached) return cached;
  const mod = (await import(pathToFileURL(join(ROOT, file)).href)) as { default?: unknown; handler?: unknown };
  const fn = mod.default ?? mod.handler;
  if (typeof fn !== 'function') {
    throw new Error(`${file} 没有导出可调用的 default handler`);
  }
  moduleCache.set(file, fn as ApiHandler);
  return fn as ApiHandler;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** 给原生 ServerResponse 挂上 Vercel 的 status/json/send 三件套 */
function decorateResponse(res: ServerResponse): VercelRes {
  const vres = res as VercelRes;
  vres.status = (code: number) => {
    res.statusCode = code;
    return vres;
  };
  vres.json = (data: unknown) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
    return vres;
  };
  vres.send = (data: unknown) => {
    if (data !== null && typeof data === 'object') return vres.json(data);
    if (!res.headersSent) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(data === undefined ? '' : String(data));
    return vres;
  };
  return vres;
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = code;
  res.end(JSON.stringify(body));
}

/** /api/* 分发；返回 false 表示不是 API 路径，交给静态分支 */
async function dispatchApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;
  // 裸 /api 也要走 API 分支：否则会掉进 SPA 兜底把 index.html 当接口响应吐回去
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return false;

  let file = STATIC_ROUTES[pathname];
  if (!file) {
    for (const route of DYNAMIC_ROUTES) {
      if (route.re.test(pathname)) {
        file = route.file;
        break;
      }
    }
  }
  if (!file) {
    // 未命中路由必须返回 JSON 404，不能落到 SPA 兜底把 index.html 当 API 响应
    sendJson(res, 404, { error: 'Not found', path: pathname });
    return true;
  }

  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams) query[k] = v;

  const body =
    req.method !== 'GET' && req.method !== 'HEAD' ? await readJsonBody(req) : undefined;

  const vres = decorateResponse(res);
  // handler 读 request.url 自己解析路径（api/sessions.ts 就是这么做的），保留原始 URL
  const vreq = Object.assign(req, { body, query, url: req.url ?? pathname });

  try {
    const handler = await loadHandler(file);
    await handler(vreq, vres);
  } catch (err) {
    console.error(`[prod-api] ${req.method} ${pathname} error:`, err);
    if (!res.headersSent) sendJson(res, 500, { error: 'API_ERROR', message: err instanceof Error ? err.message : String(err) });
    else if (!res.writableEnded) res.end();
  }
  return true;
}

/** 静态文件 + SPA 兜底 */
async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!SERVE_STATIC) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  const target = normalize(join(DIST, pathname));
  // 目录穿越防护：解析后必须仍在 dist 内
  if (target !== DIST && !target.startsWith(DIST + sep)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  let filePath = target;
  let info = await stat(filePath).catch(() => null);
  if (info?.isDirectory()) {
    filePath = join(filePath, 'index.html');
    info = await stat(filePath).catch(() => null);
  }
  if (!info?.isFile()) {
    // SPA 兜底：普通导航请求回 index.html，资源类缺失仍然 404（避免把 HTML 当 JS 回给浏览器）
    const hasExt = extname(pathname) !== '';
    if (hasExt && pathname !== '/index.html') {
      sendJson(res, 404, { error: 'Not found', path: pathname });
      return;
    }
    filePath = join(DIST, 'index.html');
    info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) {
      sendJson(res, 404, { error: 'dist/index.html 不存在，先执行 pnpm run build' });
      return;
    }
  }

  const ext = extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // 带 hash 的构建产物可长期缓存，入口 HTML 必须每次回源
  if (pathname.startsWith('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (ext === '.html') {
    res.setHeader('Cache-Control', 'no-cache');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
  res.setHeader('Content-Length', String(info.size));

  if (req.method === 'HEAD') {
    res.statusCode = 200;
    res.end();
    return;
  }
  res.statusCode = 200;
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      // 健康检查：容器 healthcheck 与部署流水线的门禁都打这里
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/healthz') {
        sendJson(res, 200, {
          ok: true,
          uptime_s: Math.round(process.uptime()),
          node: process.version,
          db_configured: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
          llm_configured: Boolean(process.env.DEEPSEEK_API_KEY),
          commit: process.env.GIT_COMMIT ?? null,
        });
        return;
      }
      if (await dispatchApi(req, res)) return;
      await serveStatic(req, res);
    } catch (err) {
      console.error('[prod-api] unhandled:', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'INTERNAL_ERROR' });
      else if (!res.writableEnded) res.end();
    }
  })();
});

// StepFun Realtime WS 代理：浏览器无法自带 Authorization 头，必须服务端中转
server.on('upgrade', (req, socket, head) => {
  if (!isRealtimeUpgradePath(req.url)) {
    socket.destroy();
    return;
  }
  handleRealtimeUpgrade(req, socket, head);
});

server.listen(PORT, HOST, () => {
  console.log(`[prod-api] listening on http://${HOST}:${PORT}`);
  console.log(`[prod-api] static: ${SERVE_STATIC ? DIST : '(disabled)'}`);
  console.log(
    `[prod-api] db: ${process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'configured' : 'MISSING'} | llm: ${process.env.DEEPSEEK_API_KEY ? 'configured' : 'MISSING'} | stepfun: ${process.env.STEPFUN_API_KEY ? 'configured' : 'MISSING'}`
  );
});

// 优雅退出：docker stop 给 10s，先停止接新连接再关库
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[prod-api] ${signal} received, draining...`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 9000).unref();
  });
}
