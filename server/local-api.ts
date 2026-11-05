import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv } from 'vite';
import { handleRealtimeUpgrade, isRealtimeUpgradePath } from './realtime-proxy.ts';
import { loadRuntimeConfigSync } from '../api/_lib/runtimeConfig.ts';

/**
 * 本地开发 API 中间件（修复：vite dev 下 /api/* 404 → 前端"题目生成失败"）
 * 生产由 Vercel 承载 serverless；本地 dev 用 ssrLoadModule 直接加载 api/*.ts handler，
 * 以最小 shim 适配 VercelRequest / VercelResponse，行为与生产一致（含 SSE 流式）。
 */

const STATIC_ROUTES: Record<string, string> = {
  '/api/llm': '/api/llm.ts',
  '/api/session': '/api/session.ts',
  '/api/message': '/api/message.ts',
  '/api/feedback': '/api/feedback.ts',
  '/api/events': '/api/events.ts',
  '/api/avatars': '/api/avatars.ts',
  '/api/avatars/presets': '/api/avatars.ts',
  '/api/tts': '/api/tts.ts',
  '/api/asr': '/api/asr.ts',
  '/api/tts-token': '/api/tts.ts',
  '/api/asr-token': '/api/asr.ts',
  '/api/realtime-token': '/api/realtime-token.ts',
  '/api/pay': '/api/pay.ts',
  '/api/settings': '/api/settings.ts',
};

// Use the same dispatcher as production; it extracts the ID and action from
// the original URL and keeps local and deployed session routes in sync.
const DYNAMIC_ROUTES: { re: RegExp; file: string }[] = [
  // 聚合路由自己按 /api/sessions/:id[/action] 分发，非法 id 由它返回 404 JSON
  { re: /^\/api\/sessions(?:\/[^/]+)?(?:\/(?:analyze|report|visual))?\/?$/, file: '/api/sessions.ts' },
];

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

interface VercelShim extends ServerResponse {
  status: (code: number) => VercelShim;
  json: (data: unknown) => VercelShim;
  send: (data: unknown) => VercelShim;
}

export function localApiPlugin(mode: string): Plugin {
  return {
    name: 'local-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      // 把 .env.local 等加载进 process.env（服务端 handler 读取 DEEPSEEK_API_KEY / STEPFUN_API_KEY / DATABASE_URL）
      const env = loadEnv(mode, process.cwd(), '');
      for (const [k, v] of Object.entries(env)) {
        if (process.env[k] === undefined) process.env[k] = v;
      }

      // 设置页写入的运行时配置覆盖 .env.local（页面填的 key 优先，清空则回落）
      loadRuntimeConfigSync();

      server.middlewares.use('/api', (req, res, next) => {
        void (async () => {
          const rawUrl = '/api' + (req.url ?? '/');
          const url = new URL(rawUrl, 'http://localhost');
          const pathname = url.pathname;

          let file = STATIC_ROUTES[pathname];
          if (!file) {
            for (const route of DYNAMIC_ROUTES) {
              const m = pathname.match(route.re);
              if (m) {
                file = route.file;
                break;
              }
            }
          }
          // 未命中任何 /api 路由：直接 404 JSON。
          // 不能 next() —— 那会落到 Vite 的 SPA/模块兜底，把 index.html 或服务端源码当响应吐给前端
          // （生产 Vercel 上同路径是 404 JSON，本地/生产行为必须一致）。
          if (!file) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Not found', path: pathname }));
            return;
          }

          const query: Record<string, string> = {};
          for (const [k, v] of url.searchParams) query[k] = v;

          const body = req.method !== 'GET' && req.method !== 'HEAD' ? await readJsonBody(req) : undefined;

          const vres = res as VercelShim;
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

          // Connect strips the /api mount prefix; handlers need the public URL.
          const vreq = Object.assign(req, { body, query, url: rawUrl });
          try {
            const mod = await server.ssrLoadModule(file);
            await mod.default(vreq, vres);
          } catch (err) {
            console.error('[local-api] %s %s error:', req.method, pathname, err);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
            }
            if (!res.writableEnded) {
              res.end(JSON.stringify({ error: 'LOCAL_API_ERROR', message: err instanceof Error ? err.message : String(err) }));
            }
          }
        })().catch(next);
      });

      // M7：StepFun Realtime WS 代理（/api/realtime upgrade → 上游，见 server/realtime-proxy.ts）
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!isRealtimeUpgradePath(req.url)) return; // 其余 upgrade（HMR 等）交还 vite
        handleRealtimeUpgrade(req, socket, head);
      });
    },
  };
}
