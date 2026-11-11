# 支付宝 AI 付接入 · 可复用 Prompt

> 把下面任意一份整段粘给编码 Agent，即可复现本仓库的支付宝接入工作。
> 中文版与英文版内容等价，按目标模型的偏好选一份。

---

## 中文版

```
你是一名资深全栈工程师，在一个已有的生产仓库里工作：群面模拟器
（React 19 + Vite + Vercel Functions + PostgreSQL，仓库 interview-new）。

任务：为这个应用接入支付宝 AI 付的两条产品线，并保证线上可验证。

## 背景
- 应用是网页应用，卖「练习次数」，用 Para 钱包地址作为免登录身份
- 生产域名 www.groupinterview.online，部署在 Vercel（Git 集成，main 分支自动发布）
- 支付宝按量付费服务已注册：service_id = API_67A60134AB7A4BCE，单价 3.00 元/次

## 要做的两件事

### 1. AI 网页应用收款（Vibe Pay 基础收款能力）
- 下单：alipay.trade.page.pay，返回自动提交表单 HTML
- 异步通知：RSA2 验签 + app_id / out_trade_no / total_amount / 收款方 四重校验
  + notify_id 去重
- 查单 / 退款 / 关单
- 订单落库，幂等（重复通知不重复发货）
- 前端购买弹窗

### 2. AI 按量付费（Machine Pay，HTTP 402）
- 无 Payment-Proof → 调 alipay.aipay.agent.payment.precreate，
  返回 402 + amtPaymentLink 响应头
- 有 Payment-Proof → 调 alipay.aipay.agent.payment.verify，
  active=true 且金额/订单号对得上才返回内容
- 同一请求体 30 分钟内复用未支付订单；已交付结果回放，不重复烧 LLM

## 硬约束
- api/ 下每个 .ts 都是一个 Vercel 函数，Hobby 档上限 12 个，当前已顶格。
  新增端点必须并入现有函数按 ?action= 分发
- 本机 pnpm store 版本错配（node_modules 由 pnpm 12 装，store v11；
  本机 pnpm 只认 v10），pnpm add 一律 ERR_PNPM_UNEXPECTED_STORE。
  禁止引入新依赖，用 node:crypto 实现 RSA2
- 支付结果只认异步通知验签 + 主动查单，绝不信任同步回跳参数
- 金额一律用字符串定点比较，禁止浮点

## 交付物
- api/_lib/alipay.ts        RSA2 签名/验签/表单/网关调用
- api/_lib/payCatalog.ts    商品与价格（可环境变量覆盖）
- api/_lib/payStore.ts      订单表 + 通知去重 + 幂等
- api/_lib/agentPay.ts      402 协议层
- api/_lib/agentInterview.ts 按量付费业务实现
- api/pay.ts                统一入口
- db/migration-v0.9-pay.sql 建表
- src/pay.ts + components/PayModal.tsx  前端
- scripts/pay-doctor.mjs    配置自检
- docs/alipay-aipay.md      非技术开通指南
- 测试：签名往返、篡改必失败、金额定点、端点各状态码

## 验收
- tsc --noEmit 零错
- 全部测试通过
- vite build 成功，check:bundle 通过
- check-functions ≤ 12
- 线上 /api/pay?action=catalog 返回 configured:true
- 线上 POST /api/agent/interview 无凭证返回 402 + amtPaymentLink
```

---

## English

```
You are a senior full-stack engineer working in an existing production repo:
a group-interview simulator (React 19 + Vite + Vercel Functions + PostgreSQL,
repo name interview-new).

Task: integrate both Alipay AI Pay product lines into this app, and make it
verifiable in production.

## Context
- The app is a web application selling "practice sessions"; a Para wallet
  address serves as the passwordless user identity
- Production domain www.groupinterview.online, deployed on Vercel
  (Git integration, auto-publish from the main branch)
- The Alipay pay-per-use service is already registered:
  service_id = API_67A60134AB7A4BCE, unit price CNY 3.00 per call

## Two things to build

### 1. AI Web App Payment (Vibe Pay basic acquiring)
- Order creation: alipay.trade.page.pay, returning auto-submitting form HTML
- Async notification: RSA2 signature verification + four-way validation of
  app_id / out_trade_no / total_amount / seller + notify_id deduplication
- Trade query / refund / close
- Persist orders; idempotent (a repeated notification must not re-deliver goods)
- Front-end purchase modal

### 2. AI Pay-Per-Use (Machine Pay, HTTP 402)
- No Payment-Proof → call alipay.aipay.agent.payment.precreate,
  return 402 with an amtPaymentLink response header
- With Payment-Proof → call alipay.aipay.agent.payment.verify;
  return the content only when active=true and both amount and order number match
- Reuse an unpaid order for the same request body within 30 minutes;
  replay already-delivered results instead of burning LLM calls again

## Hard constraints
- Every .ts file under api/ is one Vercel function; the Hobby tier caps at 12
  and the repo is already at the limit. New endpoints must be folded into an
  existing function and dispatched via ?action=
- The local pnpm store is version-mismatched (node_modules installed by pnpm 12
  with store v11; the local pnpm only accepts v10), so pnpm add always fails
  with ERR_PNPM_UNEXPECTED_STORE. Do not add new dependencies; implement RSA2
  with node:crypto
- Payment results are trusted only from a verified async notification or an
  active trade query — never from synchronous return-URL parameters
- Always compare amounts as fixed-point strings; never use floating point

## Deliverables
- api/_lib/alipay.ts         RSA2 sign/verify, form building, gateway calls
- api/_lib/payCatalog.ts     Products and prices (overridable via env var)
- api/_lib/payStore.ts       Order table + notification dedup + idempotency
- api/_lib/agentPay.ts       402 protocol layer
- api/_lib/agentInterview.ts Pay-per-use business logic
- api/pay.ts                 Single entry point
- db/migration-v0.9-pay.sql  Schema
- src/pay.ts + components/PayModal.tsx  Front end
- scripts/pay-doctor.mjs     Config self-check
- docs/alipay-aipay.md       Non-technical onboarding guide
- Tests: sign round-trip, tampering must fail, fixed-point amounts,
  every endpoint status code

## Acceptance
- tsc --noEmit reports zero errors
- All tests pass
- vite build succeeds and check:bundle passes
- check-functions ≤ 12
- Production /api/pay?action=catalog returns configured:true
- Production POST /api/agent/interview without credentials returns
  402 + amtPaymentLink
```

---

## 配套文档

| 文档 | 内容 |
| --- | --- |
| `docs/alipay-aipay.md` | 非技术开通指南（注册 → 密钥 → 签约 → 填环境变量 → 联调） |
| `docs/alipay-aipay.md` 附录 A | AI 按量付费的接口契约、402 时序、安全机制 |
| `scripts/pay-doctor.mjs` | 配置自检，`pnpm pay:doctor` |
