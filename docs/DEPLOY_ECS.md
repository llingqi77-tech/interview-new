# ECS 全自动 CI/CD + 机上 AI

> 本文是 `DEPLOY_VERCEL.md` 第 9 节的落地版。Vercel 那条线的结论仍然成立
> （`*.vercel.app` 被污染，绑自有域名即通），本文是另一条路：一台自己的 ECS，
> 完整后端能力、无函数个数/时长限制、日志和进程都在自己手里。

---

## 1. 已经就位的文件

| 文件 | 作用 |
|---|---|
| `server/prod-api.ts` | 生产 HTTP 服务器。把 `api/` 下 12 个 Vercel handler 挂到原生 Node 上，补齐 `response.status/json/send`、`request.query`、`request.body` 三套平台扩展，接管 `/api/realtime` 的 WebSocket upgrade，外加静态托管与 SPA 兜底、`/healthz`、优雅退出 |
| `Dockerfile` | 四阶段构建。运行时只留 `dist/` + `api/` + `engine/` + `data/` + `services/voiceBinding.ts` + `server/` + 生产依赖，非 root 运行，`tini` 收信号 |
| `docker-compose.yml` | `app` + `caddy` + 可选 `db`（`--profile localdb`）。日志轮转、健康检查、`depends_on` 软依赖 |
| `Caddyfile` | 自动 HTTPS、HTTP→HTTPS 跳转、WebSocket 长连接、全部 `/api/*` 关闭响应缓冲（SSE 必需） |
| `scripts/ecs/bootstrap.sh` | 一次性初始化：Docker + compose 插件、镜像加速、swap、防火墙、`deploy` 用户、`/opt/interview` 目录、`app.env` 模板 |
| `scripts/ecs/deploy.sh` | 服务器侧发布：拉镜像 → 起容器 → 健康检查 → 失败自动回滚到上一镜像 |
| `.github/workflows/deploy-ecs.yml` | 构建推镜像 → SSH 同步编排文件 → 执行部署 → 外部验证 → 失败回滚 |
| `.github/workflows/ci.yml` | 门禁：密钥扫描 / 类型 / 单测 / 构建 / 体积 |

已验证：`pnpm run typecheck` 通过；`server/prod-api.ts` 在本机实跑，`/healthz` 200、
`/api/avatars` 200（证明 `data/` 真被加载）、`/api` 与未知路径返回 JSON 404、静态与 SPA 兜底正常。

---

## 2. 架构

```
GitHub push main
   │
   ├─► Actions: ci.yml                     门禁（不过不影响发布，见 §4 说明）
   │
   └─► Actions: deploy-ecs.yml
          ├─ docker buildx build ─► 推 GHCR / 阿里云 ACR（tag = commit sha 前 12 位）
          └─ ssh deploy@ecs
                 ├─ scp docker-compose.yml / Caddyfile / deploy.sh   ← 以仓库为准
                 ├─ ./deploy.sh <image>:<sha> <sha>
                 │     ├─ docker compose pull app
                 │     ├─ up -d app  (+ caddy)
                 │     ├─ 容器内探 /healthz（90s 内）
                 │     └─ 失败 → 自动回到 .previous_image
                 └─ CI 再从公网探 https://<域名>/healthz

ECS 上跑的容器：
   caddy:2-alpine   ── 80/443，自动证书，反代
   app（本仓库镜像）── 3000，Node 24 直跑 api/*.ts
   db（可选）        ── postgres:17-alpine，首次启动按序跑 db/*.sql
```

一个进程兜住全部 API：`api/` 12 个入口在同一个 Node 里按路由表分发，
不再有 serverless 的冷启动、函数个数上限、单请求时长上限。

---

## 3. 一次性上线（六步）

### 3.0 前置检查

```bash
# 在 ECS 上
free -h          # 2G 起步，1G 会 OOM
df -h /          # 留 15G 以上（镜像 + dist 52M + pg 数据）
cat /etc/os-release | head -3
```

低于 2 核 2G：`docker build` 建议不在机器上跑（本方案构建在 GitHub 侧），
但 `docker compose pull` + 启动两个容器仍需要约 800MB 常驻。

### 3.1 初始化（root，只跑一次）

```bash
# 方式 A：仓库已拉到机器上
git clone https://github.com/<owner>/interview-new.git /tmp/repo
sudo bash /tmp/repo/scripts/ecs/bootstrap.sh

# 方式 B：直接在机器上执行
sudo SWAP_SIZE=2G bash scripts/ecs/bootstrap.sh
```

脚本会：装 Docker + compose 插件（大陆机器自动切阿里云源）、配镜像加速、
建 2G swap、放通 22/80/443（本机防火墙；**云厂商安全组要单独放通**）、
创建 `deploy` 用户并加入 docker 组、准备 `/opt/interview` 与 `app.env` 模板。

### 3.2 填密钥

```bash
sudo -u deploy nano /opt/interview/app.env
```

必填：`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DATABASE_URL`；语音功能另需 `STEPFUN_API_KEY`。
文件权限已设为 `600`，永远不会进 git。

> 数据库二选一：
> - 外部库（推荐）：`DATABASE_URL` 指向 RDS / Neon，加 `?sslmode=require`
> - 同机库：`docker compose --env-file deploy.env --profile localdb up -d`，
>   `DATABASE_URL=postgres://interview:<密码>@db:5432/interview_db`

### 3.3 CI 专用密钥

```bash
# 本地生成一对 CI 专用密钥（不要复用你自己的登录密钥）
ssh-keygen -t ed25519 -C "github-actions@interview" -f ./ci_deploy -N ""

# 公钥装到服务器
ssh-copy-id -i ./ci_deploy.pub deploy@<ECS_IP>
# 或手动：
cat ci_deploy.pub | ssh deploy@<ECS_IP> 'cat >> ~/.ssh/authorized_keys'
```

GitHub 仓库 → Settings → Secrets and variables → Actions：

| 类型 | 名称 | 值 |
|---|---|---|
| Secret | `SSH_HOST` | ECS 公网 IP 或域名 |
| Secret | `SSH_USER` | `deploy` |
| Secret | `SSH_PORT` | `22`（改过端口就填实际值） |
| Secret | `SSH_PRIVATE_KEY` | `ci_deploy` **私钥全文**（含 `-----BEGIN...`） |
| Variable | `REGISTRY` | `ghcr.io`（默认，可留空）；用 ACR 时填 `registry.cn-hangzhou.aliyuncs.com` |
| Variable | `PUBLIC_URL` | `https://interview.example.com`（有了再填） |

用阿里云 ACR 时另需 Secret：`ACR_USERNAME`、`ACR_PASSWORD`。

### 3.4 首次部署

GHCR 默认私有仓库。第一次拉取前要么把 package 设为 public，
要么在服务器上登录一次：

```bash
ssh deploy@<ECS_IP>
echo <你的 PAT> | docker login ghcr.io -u <你的GitHub用户名> --password-stdin
```

然后推送一次代码（或手动触发 workflow），或者直接手工部署第一版：

```bash
cd /opt/interview
./deploy.sh ghcr.io/<owner>/interview-new:latest <commit-sha>
```

### 3.5 域名与 HTTPS

```bash
# 域名 A 记录指向 ECS 公网 IP，然后：
ssh deploy@<ECS_IP>
cd /opt/interview
sed -i 's|^DOMAIN=.*|DOMAIN=interview.example.com|' deploy.env
docker compose --env-file deploy.env up -d caddy
docker compose --env-file deploy.env logs -f caddy   # 看证书签发过程
```

**备案**：ECS 在大陆机房时，域名必须先完成 ICP 备案，否则 80/443 会被拦。
香港/新加坡/日本节点不需要备案，可直接用域名。

### 3.6 验收

```bash
D=https://interview.example.com
curl -s -o /dev/null -w "html %{http_code} %{time_starttransfer}s\n" "$D/"
curl -s "$D/healthz"
curl -s -o /dev/null -w "api %{http_code} %{time_starttransfer}s\n" "$D/api/sessions"   # 期望 404（该路由要带 id）
curl -s -o /dev/null -w "avatars %{http_code}\n" "$D/api/avatars"                       # 期望 200
curl -N -X POST "$D/api/llm" -H 'Content-Type: application/json' -d '{"action":"reply","payload":{}}' | head -3
```

浏览器再确认三件事：摄像头权限弹窗能出（HTTPS 生效）、
`/api/llm` 的 response 是 `text/event-stream` 且逐块到达、`/healthz` 里 `db_configured` 为 `true`。

---

## 4. 日常发布

```
改代码 → git push origin main → 完成
```

流水线自动：构建镜像（带 GHA 层缓存，改前端约 60-90s，改依赖才全量）→ 推仓库 →
SSH 同步 `docker-compose.yml`/`Caddyfile`/`deploy.sh` → `deploy.sh` 拉新镜像 →
容器内健康检查 → 公网再验一次 → 通过即结束。

**回滚**：`deploy.sh` 在健康检查失败时会自动回到 `.previous_image` 记录的上一版镜像。
手工回滚：

```bash
cd /opt/interview
./deploy.sh $(cat .previous_image) manual-rollback
```

**关于 ci.yml 与 deploy-ecs.yml 并行**：两者都监听 push main。ci.yml 是门禁，
它红了不会自动拦住 deploy-ecs.yml。要严格"测试不过不发布"，
在仓库 Settings → Branches 里给 main 加 required status check（`CI / verify`），
或者把两个 workflow 合成一个（把 `deploy-ecs.yml` 的 `build` job 加
`needs: verify` 并 import ci 的 verify job）。当前分开是为了让发布链路短、
失败点清晰。

---

## 5. 大陆 ECS 的三个坑

| 坑 | 表现 | 处置 |
|---|---|---|
| GHCR 拉取慢或超时 | `deploy.sh` 卡在 pull，`manifest unknown` / 超时 | 改用阿里云 ACR（个人版免费），`REGISTRY` 变量改成 `registry.cn-hangzhou.aliyuncs.com`，加 `ACR_USERNAME`/`ACR_PASSWORD`。ACR 有 VPC 内网端点，同地域拉取走内网 |
| Docker Hub 拉不动 | `caddy:2-alpine` / `node:24-bookworm-slim` / `postgres:17-alpine` 拉不下来 | `bootstrap.sh` 已配 daocloud/腾讯云加速；失效就从阿里云镜像站的 `dockerhub` 加速地址重新配一次 |
| 域名未备案 | 80/443 直接不通，非报错而是超时 | 换香港/新加坡节点，或先走备案流程（7-20 工作日） |

另外两条容易忽略的：
- **安全组**：本机 ufw/firewalld 放通 ≠ 云厂商安全组放通。阿里云要在控制台入方向加 22/80/443。
- **EIP 与私网 IP**：ECS 的公网 IP 若为 NAT 映射的弹性 IP，`docker` 监听 `0.0.0.0` 才能被外部访问，当前配置已是。

### 5.1 大陆机房：备案空窗期怎么跑

域名没备案时，80/443 会被运营商层拦掉，但**非标端口能通**。冒烟阶段：

```bash
cd /opt/interview
sed -i 's|^DOMAIN=.*|DOMAIN=:80|' deploy.env
echo 'HTTP_PORT=8080' >> deploy.env
docker compose --env-file deploy.env up -d caddy

# 外部验证（注意：非 HTTPS，摄像头功能不可用，只能验接口与页面）
curl -s -o /dev/null -w "%{http_code}\n" http://<ECS公网IP>:8080/healthz
curl -s -o /dev/null -w "%{http_code}\n" http://<ECS公网IP>:8080/api/avatars
```

备案下来之后：

```bash
sed -i 's|^DOMAIN=.*|DOMAIN=interview.example.com|' deploy.env
sed -i 's|^HTTP_PORT=.*|HTTP_PORT=80|' deploy.env
docker compose --env-file deploy.env up -d caddy
```

Caddy 会自动签证书，摄像头功能随之可用。

### 5.2 换阿里云 ACR（大陆机房的默认选择）

GHCR 在大陆拉取不稳定，ACR 个人版免费且同地域可走 VPC 内网。

```bash
# 1) 开通：容器镜像服务 ACR → 个人实例 → 创建命名空间（例如 interview）
#    地域选与你 ECS 相同的（如 华东1 杭州）
# 2) 设置 Registry 登录密码（固定密码，不是阿里云账号密码）

# 3) GitHub 仓库侧
#    Variable REGISTRY = registry.cn-hangzhou.aliyuncs.com
#    Secret   ACR_USERNAME = <阿里云账号全名，如 xxx@xxx.aliyuncs.com>
#    Secret   ACR_PASSWORD = <刚设的 Registry 固定密码>

# 4) 镜像坐标自动变成
#    registry.cn-hangzhou.aliyuncs.com/interview/interview-new:<sha>
```

ECS 同地域时可把拉取地址换成 VPC 端点，省公网流量也更快：

```bash
# /opt/interview/deploy.env 里用 VPC 域名
APP_IMAGE=registry-vpc.cn-hangzhou.aliyuncs.com/interview/interview-new:<sha>
```

注意：CI 推送用公网端点（`registry.cn-...`），ECS 拉取可用 VPC 端点（`registry-vpc.cn-...`），
两者是同一个仓库的两个入口。流水线里已经分开，不需要手工替换：

| GitHub 配置 | 作用 |
|---|---|
| Variable `REGISTRY` | CI 推送地址，如 `registry.cn-hangzhou.aliyuncs.com` |
| Variable `PULL_REGISTRY` | ECS 拉取地址，如 `registry-vpc.cn-hangzhou.aliyuncs.com`；**留空即等于 `REGISTRY`** |

`deploy-ecs.yml` 按 `REGISTRY` 推送镜像，按 `PULL_REGISTRY` 生成部署用的镜像坐标。
先留空跑通，确认 ECS 与 ACR 同地域后再填 VPC 端点。

---

## 6. 在 ECS 上装 AI

两种装法，用途不同。

### 6.1 pi CLI（无头，用于巡检/自愈/夜间任务）

```bash
# 服务器上
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -    # 若还没装 Node
sudo npm install -g @earendil-works/pi-coding-agent

# 配 provider（key 只存在服务器本地）
pi auth login --provider <provider>
# 一次性任务
pi --tools read,grep,find,ls --print "检查 /opt/interview 下的容器日志，找出最近 24h 的 5xx 模式，输出结论"
# 结构化输出，便于 cron 管道
pi --mode json --print "读取 /opt/interview/deploy.env，报告当前镜像与提交号" > /tmp/report.json
```

资源账：pi 本身是 Node 进程，常驻约 150-300MB；模型推理在远端，不在机器上算。
2C2G 的机器上跑确定性的巡检没问题，**别在同一台机器上跑大改造**——会和
`docker compose pull`、`pnpm install` 抢内存，swap 打满后整机卡死。

### 6.2 定时巡检示例

```bash
# /etc/cron.d/interview-health
*/30 * * * * deploy cd /opt/interview && ./deploy.sh "$(grep ^APP_IMAGE= deploy.env | cut -d= -f2)" self-heal >> /var/log/interview-heal.log 2>&1
```

这条不做智能判断，只做"镜像没变但容器挂了就重新拉起来"。要带判断的版本，
把 `deploy.sh` 换成 `pi --print "..."` 驱动，或者接 `docker compose ps` 的退出码。

---

## 7. 子母 Agent：从对话框里改造 ECS

pi 的子代理机制（`subagent_spawn` / `inspect` / `wait` / `send` / `cancel`）在这里的用法。

### 7.1 三层关系

```
母会话（当前对话，拥有全部上下文与工具）
   ├─ subagent A：只读审计（read/grep/find/ls）→ 结论回传，零风险
   ├─ subagent B：带 bash 的长任务（装环境、跑压测、迁数据）→ 后台跑，母继续干别的
   └─ 子代理可以反向 subagent_send 提问，母用 requestId 回答
```

### 7.2 关键限制（决定怎么分工）

| 事实 | 影响 |
|---|---|
| 子代理是**本机独立 pi 进程**，不在 ECS 上 | 要碰 ECS 必须在 task 里写清 `ssh` 命令，或给它 `bash` 工具由它自己 ssh |
| 默认工具只有 `read/grep/find/ls` | 只读任务最安全，适合审计/核对/生成清单（本次的依赖闭包审计就是这么跑的） |
| 给 `bash` = 给它这台机器的 shell | 它能拿到你本机的 SSH 私钥。CI 专用 key 与交互 key 必须分开 |
| 子代理共享母会话的模型凭证 | 它会真实消耗额度。批量派发前先估账 |
| `task` 上限 50 KiB，默认无 timeout | 长任务显式传 `timeout`，否则可能挂到天荒地老 |
| 子代理看不到你的对话历史 | task 必须自包含：路径、目标、验收标准、禁止事项 |

### 7.3 三条可行路径

**路径 A：母代理直接驱动（适合交互式排障）**
你在对话里给出 `ssh` 目标，我在这台机器上直接 `ssh deploy@<ip> '...'` 执行，
结果即时回显，边看边改。第一次连接要你先把公钥装到 ECS 上，或者用密码（不推荐）。

**路径 B：派带 bash 的子代理做长任务（适合装环境/迁移/压测）**
比如"把 Neon 的数据迁到 ECS 上的 Postgres 并校验行数"，
派一个子代理带 `bash` 在后台跑，我同时继续改代码。它每步用 `subagent_send` 汇报，
失败点会带完整命令与输出回来。

**路径 C：agent 长在 ECS 上（适合无人值守）**
`pi --print` + cron，机器自己巡检。**没有交互、没有上下文记忆**，
只适合确定性判断。别指望它替代路径 A/B。

### 7.4 派活前的准备（一次性）

```bash
# 本机（Windows）生成一对只用于 ECS 运维的密钥
ssh-keygen -t ed25519 -f ~/.ssh/ecs_ops -N ""
# 公钥装到 ECS
ssh-copy-id -i ~/.ssh/ecs_ops.pub deploy@<ECS_IP>
# 本机 ~/.ssh/config 加别名，后续所有 agent 都用 e c s 这个别名
cat >> ~/.ssh/config <<'EOF'
Host ecs
  HostName <ECS_IP>
  User deploy
  IdentityFile ~/.ssh/ecs_ops
  ServerAliveInterval 30
EOF
```

之后任何子代理只要拿到 `bash` 工具，就能 `ssh ecs 'docker compose ps'` 干活，
不用在 task 里反复写凭证。

---

## 8. 运维手册

```bash
cd /opt/interview

docker compose --env-file deploy.env ps                    # 状态与健康
docker compose --env-file deploy.env logs -f --tail=200 app
docker compose --env-file deploy.env logs -f --tail=100 caddy
docker compose --env-file deploy.env restart app
docker stats --no-stream                                   # 内存/CPU 实时
docker system df                                           # 镜像与卷占用
docker image prune -f --filter "until=720h"                # 清 30 天前镜像
df -h /; du -sh /var/lib/docker                            # 磁盘告警先看这里
```

- **证书续期**：Caddy 自动处理，`caddy_data` 卷别删（删了会重新签发并可能触发 Let's Encrypt 频率限制）。
- **改配置**：改仓库里的 `docker-compose.yml` / `Caddyfile`，下次发布自动同步到机器；直接在机器上改会被覆盖。
- **迁移**：整机搬迁只需 `docker-compose.yml`、`Caddyfile`、`deploy.env`、`app.env` 四个文件 + `caddy_data`、`pgdata` 两个卷。
- **内存告警**：2G 机器上跑 `docker build` 会 OOM，构建一律在 CI 侧。

---

## 9. 故障定位

| 现象 | 原因 | 处置 |
|---|---|---|
| `deploy.sh` 卡在 pull | GHCR 在大陆拉不动 | 换 ACR，见 §5 |
| 容器起来但立刻退出 | 运行时常量缺失（`DEEPSEEK_API_KEY` 等）或 `ERR_MODULE_NOT_FOUND` | `docker compose logs app`；确认镜像含 `engine/`、`data/`、`services/voiceBinding.ts` |
| `/healthz` 200 但 `/api/llm` 500 | LLM key 或 base URL 错 | `/healthz` 只看进程活性，不看依赖；查 app 日志里的上游错误 |
| 接口 200 但回复一次性吐完 | Caddy 缓冲没关 | 确认 `Caddyfile` 里 `/api/*` 有 `flush_interval -1`，且请求真的走了 `handle /api/*` |
| `/api/realtime` 连不上 | WS 被通用 `/api/*` 规则吃掉 | `Caddyfile` 里 `@ws` 必须在 `handle /api/*` 之前 |
| 并发一高就 `timeout exceeded acquiring connection` | `pg` Pool `max` 太小 | `DB_POOL_MAX=10`（compose 已设）；还不行就外接连接池或换 RDS |
| 限流误伤 | 单容器下 `ratelimit.ts` 是全站共享的 600/min 桶 | 调 `GLOBAL_MAX_REQUESTS`，或把它挪到 Caddy/Redis |
| 域名打不开但 IP 正常 | 大陆机房未备案 / 安全组没放通 443 | 备案或换香港节点；控制台查安全组 |
| 摄像头无权限 | 用 IP 或 `:80` 访问，非安全上下文 | 上域名 + HTTPS；`localhost` 与 `https` 之外浏览器一律拒 |

---

## 10. 这条线 vs Vercel 线

| | ECS（本文） | Vercel（DEPLOY_VERCEL.md） |
|---|---|---|
| 成本 | 腾讯/阿里香港轻量 2C2G 约 ¥25-32/月 | 域名 ¥55-90/年 + Hobby ¥0 |
| 函数个数/时长限制 | 无 | Hobby 12 个 / 300s |
| WebSocket | 原生支持 | 不支持，必须自己搭 |
| 国内访问 | 直连，延迟取决于机房 | 自定义域名 200，TTFB ~0.3s |
| 运维 | 自己管进程/磁盘/证书/单点 | 平台管 |
| 发布速度 | 构建 60-90s + SSH 部署 | 构建后原子切换，秒级 |
| 回滚 | 脚本自动回滚到上一镜像 | 控制台一键 promote 历史部署 |

**结论**：两条线都真实可用，不冲突。面试演示要"零运维 + 秒级回滚"走 Vercel；
要"完整后端能力 + 可讲的自建发布链路 + WebSocket"走 ECS。也可以双活：
Vercel 做主入口，ECS 做备用与压测环境。
