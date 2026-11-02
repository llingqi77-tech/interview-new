# syntax=docker/dockerfile:1.7
#
# 生产镜像：Vite 构建静态产物 + Node 24 直跑 api/*.ts（内置类型擦除，无需额外编译）
#
# 构建：docker build -t interview-app .
# 运行：docker run --env-file .env.production -p 3000:3000 interview-app
#
# 为什么分三个 stage：vite / tailwind / typescript 这些只在构建期需要，
# 不进最终镜像。最终镜像只留 dist/ + api/ + server/ + 生产依赖。

# ---------- 依赖（含 devDependencies，构建需要） ----------
FROM node:24-bookworm-slim AS deps
RUN npm install -g pnpm@10.28.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- 构建 ----------
FROM deps AS build
WORKDIR /app
COPY . .
# 跳过 check-functions：那是 Vercel 专属的 12 函数上限，容器部署没有这个约束
RUN node scripts/check-secrets.mjs && npx vite build

# ---------- 生产依赖 ----------
FROM node:24-bookworm-slim AS prod-deps
RUN npm install -g pnpm@10.28.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---------- 运行时 ----------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app

# 字体与时区：生成报告里的中文渲染与 .cn 端点的时间戳都依赖这两样
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Shanghai

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY api ./api
COPY server ./server
COPY types.ts ./
# engine/ data/ services/ 是服务端闭包的一部分：api/_lib/llmRoute.ts 值导入 ../../data/roleCards.ts，
# api/session.ts 值导入 engine/roleSelector.ts，engine/roleSelector.ts 值导入 services/voiceBinding.ts。
# 漏掉任何一个，第一个 /api/llm 请求就 ERR_MODULE_NOT_FOUND。
COPY engine ./engine
COPY data ./data
COPY services/voiceBinding.ts ./services/voiceBinding.ts
# 非 root 运行；api/ 只读，产物只读，写操作全部走数据库
USER node

EXPOSE 3000

# 健康检查直接打 /healthz，与部署流水线的门禁同一判据
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "server/prod-api.ts"]
