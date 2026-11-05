# 公网部署方案（Vercel + 自有域名 + CI/CD）

> 结论先行：**不换平台，换域名。** 本项目所需的公网访问、前后端分离、push 即自动编译发布，
> 在现有 Vercel 栈上全部满足。唯一的致命问题是 `*.vercel.app` 这个域名后缀在国内被 DNS 污染。
> 绑一个自有域名即恢复国内直连。

本文替代此前 `DEPLOY_GITHUB_PAGES.md` / `DEPLOY_CN.md` / `deploy-aliyun.sh` 描述的方案，那三份
都基于"把 dist 传到静态托管"的假设，而本项目有 12 个服务端函数、Postgres 和 SSE 流式响应，
静态托管从架构上就不成立。

---

## 1. 实测证据（2026-10-30，本机直连，绕过本地代理 10808）

### 1.1 `*.vercel.app` 被污染

```
$ nslookup interview-practice-77.vercel.app 223.5.5.5      # 阿里公共 DNS
Addresses:  2a03:2880:f11c:8083:face:b00c:0:25de           # ← face:b00c 是投毒特征串
            74.86.17.48                                    # ← 空洞 IP，无服务

$ curl -o /dev/null -w "connect=%{time_connect} ttfb=%{time_starttransfer} code=%{http_code}"
   https://interview-practice-77.vercel.app/
connect=0.000000  ttfb=0.000000  code=000  total=12.004412   # 12s 超时，TCP 都建不起来

$ curl -x http://127.0.0.1:10808 ...                        # 走代理
code=200  ttfb=2.747700                                    # 能通，但 2.7s
```

### 1.2 Vercel 自定义域名国内直连正常

| 域名 | 类型 | remote_ip | connect | TTFB | 总耗时 | code |
|---|---|---|---|---|---|---|
| `nextjs.org` | Vercel 自定义域名 | 64.239.109.193 | 0.096s | **0.291s** | 0.496s | 200 |
| `vercel.com` | Vercel 自定义域名 | 64.239.123.1 | 0.122s | **0.354s** | 0.710s | 200 |
| `ui.shadcn.com` | Vercel 自定义域名 | 66.33.60.194 | 0.182s | **0.364s** | 0.675s | 200 |
| `interview-practice-77.vercel.app` | 平台免费后缀 | — | 0.000s | — | 12s 超时 | 000 |

**判定：被墙的是域名后缀，不是 Vercel 的落脚点 IP，也不是这台服务器。** 换域名后缀即可，
0 行代码改动。

### 1.3 这条证据链反推一个隐患

`.vercel.app` 在国内不可达，意味着本项目此前所有"线上可用"的验证如果是在代理下做的，
等于没有验证。换域名后必须按第 6 节在**关闭代理**的前提下重跑一遍。

---

## 2. 已否决的选项及理由

| 选项 | 否决理由 |
|---|---|
| GitHub Pages | 只有静态产物。`api/` 下 12 个函数、Postgres 连接、SSE 流式 LLM 响应全部无处安放。前端能开、AI 全挂，比打不开更伤。且 `*.github.io` 国内解析质量同样不可控。 |
| 阿里云 OSS / 腾讯云 COS + CDN | 同上，静态托管。且绑定 CDN 加速域名要求**域名备案**。 |
| 大陆节点（阿里云/腾讯云 ECS，杭州/北京） | 体验最好，但域名必须完成 ICP 备案，流程 7–20 个工作日，个人主体还要核验材料。面试时间线上不可控。有能力现在就备案的话，这是长期最优解，见第 8 节。 |
| 内网穿透（frp / ngrok / cpolar） | 需求已排除。链接不稳定，面试官打开时隧道可能已断。 |
| Cloudflare Workers / Pages | 落点 `*.workers.dev`、`*.pages.dev` 在国内同样污染；且 `api/*` 的 Vercel handler 签名要整体改写为 Workers 的 `fetch` 签名，是本方案里唯一需要重写代码的选项。收益为零。 |
| Railway / Render / Fly.io / Zeabur / Sealos | 都是好平台，但国内可达性仍需靠自有域名兜底，等于本方案的下半段；同时 `server/local-api.ts` 是 Vite 插件而非独立服务器，需要额外写生产入口。多一层依赖，不解决问题。仅在想要"一台机器全包、摆脱 serverless 计费"时才值得看第 8 节。 |

---

## 3. 目标架构

```
GitHub main 分支
   │  push
   ├─► GitHub Actions (ci.yml)      门禁：密钥扫描 → 类型 → 单测 → 构建 → 体积
   │
   └─► Vercel Git 集成             自动 pnpm install → pnpm run build → 发布 production
          │
          ├─ 静态产物 dist/  ──► Vercel CDN（全球边缘，含国内可达节点）
          └─ api/*.ts        ──► Vercel Functions，region = hkg1（香港）
                                     │
                                     ├─► Postgres（同区域或低延迟区域）
                                     └─► LLM / 语音端点（api.moonshot.cn、StepFun）

自定义域名  https://<your-domain>  ──► CNAME cname.vercel-dns.com
```

- 前端：Vite 构建的静态 SPA，走 CDN，命中缓存后是边缘直出。
- 后端：`api/` 下每个文件一个 Vercel Function，SSE 流式响应原生支持（`api/_lib/sse.ts` 已实现）。
- 数据库：`pg` 连接池，serverless 场景每个实例一个小池，需要连接池代理（见 5.4）。
- 链上：Monad 合约与 Envio 索引器在外部，与本部署无关，只需在 Vercel 环境变量里配 `VITE_*`。

---

## 4. 必做三步

### 4.1 注册域名（唯一无法自动化的一步，约 1 小时 + 实名审核）

- 注册地：阿里云万网、腾讯云 DNSPod、Cloudflare Registrar 均可。个人 `.com` 首年约 ¥55–90。
- **不需要备案**：备案只约束"使用中国大陆境内服务器对外提供服务"。解析到 Vercel 属于境外节点，
  不受约束。
- 域名必须**实名认证**（工信部要求），1–3 天审核，建议今天就下单。
- 命名建议：行业词 + 项目词，例如 `mockinterview.dev`、`panel-room.cn`。面试场景下域名本身就是
  作品集的一部分，别用随机字符串。

### 4.2 绑定到 Vercel 项目 `interview-second`

1. Vercel 控制台 → 项目 `interview-second` → Settings → Domains → Add。
2. 输入域名。Vercel 会给出 DNS 记录：
   - 根域 `example.com`：`A 76.76.21.21`
   - 子域 `www.example.com`：`CNAME cname.vercel-dns.com`
3. 到域名注册商的 DNS 面板加上这两条，等生效（通常 1–10 分钟）。
4. Vercel 自动签发 Let's Encrypt 证书。**HTTPS 是硬需求**：本项目用 MediaPipe 读摄像头，
   非 HTTPS 下 `getUserMedia` 会被浏览器直接拒绝。
5. 把 `interview-practice-77.vercel.app` 保留为指向同一项目的别名（不要删），旧链接仍可用代理访问。

### 4.3 函数区域改香港

已写入 `vercel.json`：

```json
"regions": ["hkg1"]
```

`hkg1` 是 Vercel 的香港区域（AWS `ap-east-1`，已核对官方区域表）。

为什么不留在默认的 `iad1`（美东）：

| 调用目标 | 从 iad1 | 从 hkg1 |
|---|---|---|
| `api.moonshot.cn`（LLM，主要耗时来源） | 跨太平洋，单次往返 200–400ms，推理首字延迟叠加 | 同区域圈，单次往返 30–60ms |
| 阿里云 RDS | 跨境，抖动明显 | 同区域圈 |
| 国内面试官访问 `/api/*` | 请求先进美东再回国内 | 请求进香港，就近处理 |

**注意**：region 设置只影响函数执行地，静态资源始终走 CDN 就近分发，不受影响。
Hobby 档可以设置**一个**默认区域；Pro 才能多区域并行。

---

## 5. 配套必须跟着搬的两件事（否则上面白做）

### 5.1 函数区域与数据库必须在同一地理圈

`api/_lib/db.ts` 用的是 `pg` 的 `Pool`。函数在 hkg1、数据库在国内大陆的话，每条 SQL 都是
跨境往返 60–150ms，一个会话流程里十几次查询就吃掉 1–2 秒。选择：

| 方案 | 说明 | 成本 |
|---|---|---|
| Neon（新加坡/东京区） | Serverless PG，自带连接池代理，与本项目用法契合 | 免费档够用；Launch $19/月 |
| 阿里云 RDS PostgreSQL 香港区 | 与函数同区域，无需改连接串结构 | 约 ¥200/月起 |
| 保留现有大陆 RDS | 能用，但每个请求都跨境，且跨境链路抖动不可控 | ¥0 |

**推荐 Neon 新加坡区**：`DATABASE_URL` 加 `?sslmode=require`，和现在 `db.ts` 的 SSL 分支兼容。
迁移只需 `psql "$NEW_URL" -f db/migration-v0.7.sql`（再按序跑 `migration-v0.7.1-wallet.sql`、
`migration-v0.8-format.sql`）。

### 5.2 LLM 端点的可达性

`DEEPSEEK_BASE_URL=https://api.moonshot.cn/v1` 是国内端点。从 hkg1 调用正常，从 iad1 调用会
明显变慢，个别情况下国内端点对海外出口有限速。若发现首字延迟异常，改走国际端点
`https://api.moonshot.ai/v1`（需对应平台的 key），代码不用动，只改环境变量。
`DEEPSEEK_MODEL_<ACTION>` 那套按 action 覆盖的机制可以只把 `reply` 换到更快的模型，其余保持不变。

### 5.3 免费档最紧的一条：函数数量正好顶格

`api/` 下非下划线开头的入口正好 **12 个**，`scripts/check-functions.mjs` 按 Hobby 的 12 个上限
卡着，加任何新端点都会在构建阶段直接失败。

已把该脚本的阈值改为可由环境变量覆盖：

```js
const limit = Number(process.env.VERCEL_FUNCTION_LIMIT ?? 12);
```

升级 Pro 后在 Vercel 项目环境变量里设 `VERCEL_FUNCTION_LIMIT=100`（或更高），门禁即按新档位执行。
Vercel 现行 Functions 限额表里，硬约束是时长、内存、体积、并发，**函数个数上限是免费档的约束**；
升级后以实际部署输出为准。

### 5.4 连接池

`api/_lib/db.ts` 已经把 `max` 压低了（serverless 每实例一池）。Vercel Functions 会横向扩实例，
实例数一多就吃光 Postgres 的连接数上限。两道保险：

- 用带连接池代理的数据库（Neon 自带 `-pooler` 主机名，直接换 host 即可）。
- 或在 `DATABASE_URL` 上挂 PgBouncer（transaction 模式），项目注释里已标注这一做法。

---

## 6. 验收清单（必须关闭代理执行）

```bash
D=https://<your-domain>

# 1) 首页可直连（关掉代理再跑）
curl -s -o /dev/null -w "html ttfb=%{time_starttransfer}s code=%{http_code}\n" "$D/"

# 2) 后端函数真的在跑（不是静态 404）
curl -s -o /dev/null -w "api  ttfb=%{time_starttransfer}s code=%{http_code}\n" "$D/api/sessions"

# 3) SSE 流式没有被缓冲（应逐块吐出，不是一次性返回）
curl -N -X POST "$D/api/llm" -H 'Content-Type: application/json' \
     -d '{"action":"reply","payload":{}}' | head -5

# 4) 数据库通了（未配置时返回 503 + DATABASE_NOT_CONFIGURED，不是 500）
curl -s "$D/api/sessions" | head -c 200

# 5) 证书链
curl -sI "$D/" | head -1
```

预期：1、2 在 0.5s 内 200；3 有增量输出；4 返回真实数据而非 503；5 是 HTTP/2 200。

浏览器侧额外确认：

- 摄像头权限弹窗能出现（证明 HTTPS 生效，MediaPipe 链路正常）。
- DevTools → Network：`/api/llm` 的 response 是 `text/event-stream`，`Transfer-Encoding: chunked`。
- 请求头 `x-vercel-id` 里能看到 `hkg1`，确认函数真的在香港执行。

---

## 7. CI/CD：两种模式，选一个

### 模式 A（当前，零配置）：Vercel Git 集成负责发布，Actions 负责门禁

- 推 `main` → Vercel 自动 `pnpm install` → `pnpm run build` → 发布 production → 域名指向新版本。
- 推其他分支 / 开 PR → 自动生成 Preview 部署，独立 URL，供面试前联调。
- `.github/workflows/ci.yml` 并行跑 `check:secrets → typecheck → test → build → check:bundle`，
  红了在 PR 上卡红，但**不会**阻止 Vercel 已经开始的发布。

优点：零配置、开箱即用、Preview URL 是 Vercel 的强项。
缺点：门禁与发布是两条并行流水线，测试失败时线上已经被新版本覆盖。

### 模式 B（推荐，面试可讲）：CI 通过才发布，唯一真相源

在 Vercel 项目 Settings → Git 里关掉自动部署（或 `vercel.json` 设 `"git": {"deploymentEnabled": false}`），
改用 Actions 驱动。准备三个仓库 Secret：`VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`。

`.github/workflows/deploy-vercel.yml`：

```yaml
name: Deploy to Vercel

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read
  pull-requests: write

env:
  VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '10.28.0' }
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm run check:secrets
      - run: pnpm run typecheck
      - run: pnpm run test
      - run: pnpm run build
      - run: pnpm run check:bundle

  preview:
    # PR 只出预览，不进生产
    if: github.event_name == 'pull_request'
    needs: verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '10.28.0' }
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'pnpm'
      - run: npx vercel@latest pull --yes --environment=preview --token=${{ secrets.VERCEL_TOKEN }}
      - run: npx vercel@latest build --token=${{ secrets.VERCEL_TOKEN }}
      - id: deploy
        run: |
          url=$(npx vercel@latest deploy --prebuilt --token=${{ secrets.VERCEL_TOKEN }})
          echo "url=$url" >> "$GITHUB_OUTPUT"
      - uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `Preview: ${{ steps.deploy.outputs.url }}`
            })

  production:
    if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'
    needs: verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '10.28.0' }
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'pnpm'
      - run: npx vercel@latest pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
      - run: npx vercel@latest build --prebuilt --token=${{ secrets.VERCEL_TOKEN }}
      - run: npx vercel@latest deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
```

要点：

- `vercel build --prebuilt` 在 Actions 里完成编译，Vercel 只负责上传产物，**构建只跑一次**。
- `verify` 是 `needs` 前置，测试红则根本不进 deploy job，线上版本不受影响。
- 环境变量在 Vercel 侧维护（`vercel pull` 会拉到本地临时 `.vercel/.env.*`），不落进仓库。
- 这条流水线本身就是面试里"你怎么做发布"的标准答案：门禁、预览、原子发布、可回滚。

---

## 8. 成本

达成全部硬需求（公网直连 + 前后端 + CI/CD）的最小组合：

| 项 | 规格 | 价格 | 说明 |
|---|---|---|---|
| 域名 | `.com` | ¥55–90 / 首年 | 唯一必需支出 |
| Vercel | Hobby | ¥0 | 300s 函数时长、单区域、12 函数上限、100GB 带宽 |
| Postgres | Neon Free | ¥0 | 0.5GB 存储，够演示；Launch $19/月（≈¥140）解锁 10GB 与常驻 |
| **合计** | | **≈¥90 / 年** | 完全可用 |

预算放开时按需加：

| 升级项 | 价格 | 买到什么 |
|---|---|---|
| Vercel Pro | $20/月（≈¥145，含 $20 用量额度） | 函数时长 800s、多区域、解除函数个数上限、更高并发与带宽、团队席位 |
| Neon Launch | $19/月 | 常驻不停机（免费档会冷启动）、更大存储 |
| RDS 香港 | ¥200/月起 | 如果要全阿里云栈 |

**我的建议：先只买域名跑起来，量级不够再升 Pro。** 面试演示的并发量级，Hobby 档绰绰有余；
真正需要 Pro 的触发点只有一个——你要加第 13 个 API 端点。

---

## 9. 备选：一台香港服务器全包（彻底摆脱 serverless）

适用条件：不想被函数个数/时长/计费模型约束，或想讲"我自己做的发布流水线"。

成本：腾讯云香港轻量 2 核 2G / 20Mbps 约 **¥25–32/月**，阿里云香港轻量同档位近似；域名同第 4.1 节，
**香港节点同样不需要备案**。

架构：`Caddy`（自动 HTTPS + 静态 dist/ + `/api/*` 反代） + `Node`（复刻 `server/local-api.ts` 的
shim 逻辑，把 `api/*.ts` 直接挂到 `http.createServer`） + Postgres（同机 Docker 或云端）。

改动量（**已全部实现**，见 `docs/DEPLOY_ECS.md`；下面是文件与其职责）：

1. `server/prod-api.ts` —— 把 `local-api.ts` 里 `ssrLoadModule` 换成动态 `import()`，
   加上静态路由表和 body 解析，约 80 行。Vercel handler 是 `(req, res)` 语义，`vres.status/json/send`
   shim 可以原样搬。
2. `Dockerfile` —— 多阶段：`pnpm install --frozen-lockfile` → `pnpm run build` → 只留 `dist/`、
   `api/`、`server/prod-api.ts`、`node_modules`（或 bun/esbuild 打单文件）。
3. `docker-compose.yml` —— `app` + `postgres` + `caddy`。
4. `Caddyfile` —— `your-domain.com { root * /srv/dist; try_files {path} /index.html; reverse_proxy /api/* app:3000 }`。
5. `.github/workflows/deploy-vps.yml` —— 构建镜像 → 推 GHCR 或阿里云 ACR → `ssh` 到机器
   `docker compose pull && docker compose up -d`。SSH 用 `appleboy/ssh-action`，密钥走 Secrets。

取舍：省钱（¥25/月 vs $20/月）、SSE 无任何平台限制、日志在自己手里；
换来的是你要自己管进程存活、磁盘、证书续期、单点故障。面试项目没必要，但如果你要把
"服务器运维 + 发布链路"当卖点，这套是加分项。

---

## 10. 故障定位

| 现象 | 原因 | 处置 |
|---|---|---|
| 国内打不开，代理能开 | 用的是 `*.vercel.app` 域名 | 绑自有域名，见 4.2 |
| 首页 200，`/api/*` 404 | 函数未被识别，文件被下划线前缀排除或构建未产出 | 看 Deployments → Build Logs 里的 Functions 列表 |
| `FUNCTION_INVOCATION_FAILED` | 运行时异常 | Runtime Logs；`tsconfig.json` 的 `rewriteRelativeImportExtensions` 保证 `.ts` 导入被改写为 `.js` |
| `/api/sessions` 返回 503 | `DATABASE_URL` 未配或指向不可达实例 | Vercel 环境变量按 Production / Preview 分别配 |
| 首字延迟异常高 | 函数在 iad1，LLM 端点在国内 | 确认 `regions: ["hkg1"]` 生效，见 `x-vercel-id` |
| 摄像头无权限弹窗 | 非 HTTPS 或域名证书未就绪 | 确认证书签发完成，`curl -sI` 看证书 |
| 构建报函数数量超限 | 超过 12 个入口 | 合并入口，或设 `VERCEL_FUNCTION_LIMIT` |
| 推送后未自动构建 | Git 连接断开 / 生产分支不是 main / `deploymentEnabled` 被关 | 逐项检查，别用重复 Deploy Hook 掩盖 |
| Postgres 报连接数超限 | serverless 实例数超过连接上限 | 换带池代理的主机名，或上 PgBouncer |

---

## 11. 与旧文档的关系

| 文件 | 状态 |
|---|---|
| `DEPLOY_VERCEL.md`（本文） | **现行**。公网部署唯一入口。 |
| `.github/workflows/deploy.yml` | Pages 自动触发已停用，仅保留 `workflow_dispatch` 手动触发。 |
| `.github/workflows/ci.yml` | 新增门禁流水线。 |
| `DEPLOY_GITHUB_PAGES.md` / `GITHUB_PAGES_SETUP.md` | 已失效，静态托管不成立。 |
| `DEPLOY_CN.md` | 已失效，基于"key 打包进前端"的旧架构，当前 `api/` 已把 key 全部收归服务端。 |
| `deploy-aliyun.sh` | 已失效，同上；保留作历史记录，不要执行。 |
