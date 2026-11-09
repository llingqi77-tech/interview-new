# 支付宝 AI 付接入说明（AI 网页应用收款）

> 面向不写代码的人。你只需要照着第 2 章点鼠标，第 3 章之后是我已经做完的部分。

---

## 0. 一句话说清

这个应用是**网页应用**，卖的是**练习次数**，所以对应支付宝的产品是
**Vibe Pay · AI 网页应用收款 · 基础收款能力**（内部代号 `webpay`）。

支付通道已经写进代码了：下单、异步通知、查单、退款、关单、订单落库、购买弹窗。
**缺的只有你的支付宝账号和密钥**——那部分只能你本人操作，因为要实名、要签约。

---

## 1. 现在的状态

| 事项 | 谁做 | 状态 |
| --- | --- | --- |
| 支付通道代码 | 我 | 已完成 |
| 订单表 + 幂等 + 验签 | 我 | 已完成 |
| 购买弹窗 + 前端客户端 | 我 | 已完成 |
| 单元测试（24 条） | 我 | 全过 |
| 支付宝开放平台账号 | **你** | 待办 |
| 应用 AppID + 密钥 | **你** | 待办 |
| 签约「AI 网页应用收款」 | **你** | 待办 |
| 填环境变量 + 联调 | 你 + 我 | 待办 |

---

## 2. 你要做的事（照着点，约 40 分钟）

### 2.1 注册支付宝开放平台

1. 打开 <https://open.alipay.com/>
2. 用支付宝扫码登录
3. 首次进入会让你选身份：**个人开发者** 或 **企业**。
   - 个人也能收款（这个产品支持个人身份），选个人即可
   - 企业需要营业执照，流程更长

### 2.2 创建应用

1. 控制台 → **产品中心 / 我的应用** → **创建应用**
2. 应用类型选 **网页/移动应用**
3. 填应用名称（比如「群面模拟器」）、应用简介
4. 创建完，在应用详情页顶部能看到 **APPID**（16 位数字，形如 `2021000000000000`）
   → **记下来，这就是 `ALIPAY_APP_ID`**

### 2.3 生成密钥（最关键的一步）

支付宝用 RSA2 签名。你需要一对密钥：**应用私钥**（自己留着）和 **应用公钥**（传给支付宝）。

1. 下载官方工具：<https://opensearch.alipay.com/tools/keytool.htm>
   （页面里叫「支付宝开放平台密钥工具」，Windows / Mac 都有）
2. 打开工具 → 选 **RSA2** → 密钥长度 **2048** → 点「生成密钥」
3. 工具会给你两段：
   - **应用私钥**（一长串，`MIIE...` 开头）→ 这就是 `ALIPAY_PRIVATE_KEY`
   - **应用公钥**（一长串，`MIIB...` 开头）→ 下一步要传给支付宝
4. **应用私钥绝对不要发给任何人，不要提交到 git，不要贴到聊天里。**
   只填进服务器的环境变量。

> 工具里如果让你选格式：选 **PKCS#1**（默认）。如果你拿到的是 PKCS#8，
> 把 `ALIPAY_KEY_TYPE` 设成 `PKCS8` 就行，两种代码都支持。

### 2.4 上传应用公钥，拿支付宝公钥

1. 回到开放平台 → 你的应用 → **开发设置** → **接口加签方式**
2. 加签方式选 **公钥**（不是「公钥证书」，公钥模式更简单）
3. 把 2.3 生成的 **应用公钥** 粘进去，保存
4. 保存后页面会显示一段 **支付宝公钥**（`MIIB...` 开头）
   → **记下来，这就是 `ALIPAY_PUBLIC_KEY`**

> 最容易搞错的地方：`ALIPAY_PUBLIC_KEY` 要填的是**支付宝公钥**，
> 不是你自己生成的**应用公钥**。填反了会一直报 `invalid-signature`。

### 2.5 签约「AI 网页应用收款」

1. 开放平台 → **产品中心** → 搜索 **AI 网页应用收款**（旧名「网站支付」「快捷支付」）
2. 点 **立即签约 / 申请开通**
3. 会要求填：
   - **经营类目（MCC）**：按你的实际业务选，比如「教育培训 / 在线教育」
   - **网站信息**：你的站点地址
   - **3 张网站截图**：要求是**支付页**——就是展示「支付宝付款方式、等待用户去支付」的那个页面
     （不是支付成功页，也不是首页）
4. 提交后等审核，一般 1-3 个工作日

> 截图现在还没有？先把代码和环境变量配好，用沙箱跑通，
> 沙箱里能截出真实的支付页，再拿去签约。

### 2.6 把值填进环境变量

在服务器（或本地 `.env.local`）里填这几项，其余留空即可：

```
ALIPAY_APP_ID=2021000000000000
ALIPAY_PRIVATE_KEY=MIIE...（应用私钥，一长串）
ALIPAY_PUBLIC_KEY=MIIB...（支付宝公钥，一长串）
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
ALIPAY_NOTIFY_URL=https://你的域名/api/pay?action=notify
ALIPAY_RETURN_URL=https://你的域名/api/pay?action=return
ALIPAY_ADMIN_TOKEN=自己随便设一个长口令（退款/关单要用）
```

**沙箱联调**时改成：

```
ALIPAY_GATEWAY=https://openapi-sandbox.dl.alipaydev.com/gateway.do
```

沙箱的 AppID 和密钥在开放平台 → **沙箱应用** 里单独给，跟正式的不一样。

---

## 3. 我已经做完的部分

### 3.1 文件清单

| 文件 | 作用 |
| --- | --- |
| `api/_lib/alipay.ts` | 支付宝网关协议：RSA2 签名、异步通知验签、生成支付表单、调查单/退款/关单 |
| `api/_lib/payCatalog.ts` | **商品与价格**（改这里） |
| `api/_lib/payStore.ts` | 订单落库、通知去重、幂等状态迁移 |
| `api/pay.ts` | 统一入口，按 `?action=` 分发 |
| `db/migration-v0.9-pay.sql` | 建表 SQL（服务端首次调用会自动建，手工跑也行） |
| `src/pay.ts` | 前端客户端：下单、提交表单、查单、轮询等支付结果 |
| `components/PayModal.tsx` | 购买弹窗 |
| `tests/pay.test.ts` | 24 条测试：签名往返、篡改必失败、金额定点比较、端点行为 |

### 3.2 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/pay?action=catalog` | 商品目录 + 支付是否已配置 |
| POST | `/api/pay?action=create` | 下单，body `{sku, wallet_address?, session_id?}`，返回自动提交表单 HTML |
| POST | `/api/pay?action=notify` | 支付宝异步通知（form-urlencoded），回纯文本 `success` / `fail` |
| GET | `/api/pay?action=return` | 同步回跳结果页（只展示，不判定成功） |
| GET | `/api/pay?action=query&out_trade_no=` | 主动查单（本地 + 支付宝） |
| POST | `/api/pay?action=refund` | 退款，需请求头 `x-admin-token` |
| POST | `/api/pay?action=close` | 关单，需请求头 `x-admin-token` |
| GET | `/api/pay?action=orders&wallet_address=` | 本地订单列表 |

### 3.3 支付结果怎么判定

**只认两条路**，同步回跳的参数一律不信（可伪造）：

1. 异步通知：验签通过 → 校验 `app_id` / `out_trade_no` / `total_amount` / 收款方 → 按 `notify_id` 去重 → 状态迁移
2. 主动查单：`alipay.trade.query` 返回 `TRADE_SUCCESS` / `TRADE_FINISHED`

异步通知丢了怎么办？前端 `waitForPaid()` 会轮询 `action=query` 兜底。

### 3.4 发货钩子在哪

`api/pay.ts` 的 `handleNotify` 里，`markPaidIdempotent` 返回 `true` 的那一支：

```ts
if (PAID_STATUSES.has(tradeStatus) && !isRefundEvent) {
  await markPaidIdempotent(pool, { ... });
  // ← 在这里加次数 / 开权益
}
```

`markPaidIdempotent` 用 `WHERE status <> 'PAID'` 做条件更新，
所以支付宝重发通知**不会重复发货**。

---

## 4. 改商品和价格

打开 `api/_lib/payCatalog.ts`，改 `DEFAULT_CATALOG`：

```ts
export const DEFAULT_CATALOG: PaySku[] = [
  { sku: 'practice_5',  subject: '群面模拟 5 场',  amount: '9.90',  description: '...' },
  { sku: 'practice_20', subject: '群面模拟 20 场', amount: '29.90', description: '...' },
];
```

规则：
- `sku` 只能小写字母/数字/下划线/短横线，≤32 字符
- `subject` 是收银台标题，不能含 `/ = &` 等特殊字符
- `amount` 是**字符串**，两位小数，范围 0.01 ~ 100000000

不想改代码？用环境变量覆盖：

```
ALIPAY_PAY_CATALOG=[{"sku":"practice_10","subject":"群面模拟 10 场","amount":"19.90"}]
```

---

## 5. 本地跑起来测

```bash
# 0. 先自检配置（填完密钥后跑这个，一条命令告诉你配得对不对）
pnpm pay:doctor

# 1. 装依赖（如果 node_modules 是好的就跳过）
pnpm install

# 2. 填 .env.local（至少 DATABASE_URL + 上面 4 个 ALIPAY_* 必填项）
cp .env.example .env.local

# 3. 起开发服务器
pnpm dev

# 4. 打开 http://localhost:5173 ，点右上角「购买次数」
```

只想验证后端通不通：

```bash
curl http://localhost:5173/api/pay?action=catalog
```

返回 `"configured": true` 说明密钥读到了。

**本地测异步通知**：支付宝要能访问到你的 `notify_url`，localhost 不行。
用内网穿透（ngrok / cloudflared）拿一个公网 HTTPS 地址，填进 `ALIPAY_NOTIFY_URL`。
或者干脆跳过通知，用 `action=query` 主动查单验证（代码已支持）。

---

## 6. 上线检查清单

- [ ] `ALIPAY_APP_ID` / `ALIPAY_PRIVATE_KEY` / `ALIPAY_PUBLIC_KEY` 三项都填了
- [ ] `ALIPAY_GATEWAY` 是生产网关（不是 sandbox）
- [ ] `ALIPAY_NOTIFY_URL` 是公网 HTTPS，**无空格、无重定向**，能返回纯文本 `success`
- [ ] `ALIPAY_RETURN_URL` 指向 `/api/pay?action=return`
- [ ] `ALIPAY_ADMIN_TOKEN` 设了强口令（不设的话退款/关单直接 403）
- [ ] `DATABASE_URL` 配了，`pay_orders` / `pay_notify_events` 两张表建出来了
- [ ] 用 1 分钱真实下单跑通一次，确认订单状态变成 `PAID`
- [ ] 确认发货钩子真的发了货，且重复通知不会重复发

---

## 7. 报错对照表

| 现象 | 原因 | 怎么修 |
| --- | --- | --- |
| `invalid-signature` / 验签失败 | 私钥格式不对，或 `ALIPAY_PUBLIC_KEY` 填成了应用公钥 | 检查 `ALIPAY_KEY_TYPE`；确认公钥是「支付宝公钥」 |
| 收银台报「订单金额与签约不符」 | 签约的产品码不是 `FAST_INSTANT_TRADE_PAY` | 确认签的是「AI 网页应用收款 / 网站支付」 |
| 通知一直重发 | 你的接口没回纯文本 `success` | 看服务端日志，`handleNotify` 里 `fail(reason)` 会打原因 |
| 通知回 `fail` 但日志说 `order not found` | 下单和通知不是同一个库 | 检查 `DATABASE_URL` 是否指向同一实例 |
| 点「购买次数」提示未配置 | 环境变量没生效 | 重启服务；Vercel 要重新部署 |
| 支付页白屏 | 前端把表单 HTML 当 URL 跳转了 | 必须用 `submitPaymentForm()`，不能 `location.href` |
| `ALIPAY_NOT_CONFIGURED` 503 | 三项必填缺一 | 补齐 `ALIPAY_APP_ID` / `ALIPAY_PRIVATE_KEY` / `ALIPAY_PUBLIC_KEY` |

---

## 8. 安全须知

1. **应用私钥只在服务端**。前端 bundle 里不能出现，`.env.local` 不进 git。
2. **同步回跳不可信**。`return_url` 带的参数任何人都能伪造，代码里只用来展示。
3. **金额以本地订单为准**。通知里的 `total_amount` 必须和库里的一致才认。
4. **退款/关单要口令**。`ALIPAY_ADMIN_TOKEN` 不配就是关闭状态，这是故意的。
5. **通知必须幂等**。`notify_id` 唯一约束 + 条件更新，双保险。

---

## 9. 为什么没用官方 `alipay-sdk`

官方推荐 `npx -y @alipay/alipay-aipay@latest install` 装 Skill 走全流程。
本机 `node_modules` 是 pnpm 12 装的（store `v11`），而本机所有 pnpm 版本只认 `v10`，
`pnpm add` 一律 `ERR_PNPM_UNEXPECTED_STORE`，装不进新依赖。

所以改成用 Node 内置 `node:crypto` 直接实现网关协议——协议本身很小
（排序拼串 + SHA256withRSA + base64），少一个运行时依赖，也少一条供应链面。
正确性由 `tests/pay.test.ts` 兜底：签名/验签自洽往返、篡改任一字段必失败、
与 `node:crypto` 直接签名逐字节一致。

等工具链修好想换回 SDK 也可以，`api/_lib/alipay.ts` 是唯一需要替换的文件，
对外接口（`buildPagePayForm` / `callGateway` / `verifyNotifySign`）保持不变即可。

---

# 附录：AI 按量付费（Machine Pay）

上面第 1–9 章讲的是**网页应用收款**（用户在网页点「购买次数」跳收银台）。
这一节是**第二条产品线**：让 AI 智能体调你的 API 时按次自动扣费，基于 HTTP 402。

两条线互不影响，可以只开一条，也可以都开。

## A.1 已注册的服务

| 项 | 值 |
| --- | --- |
| 服务名称 | AI 群面模拟 |
| 服务 ID | `API_67A60134AB7A4BCE` |
| 单价 | 3.00 元/次 |
| 状态 | 审核已通过 |
| 接口地址 | `https://www.groupinterview.online/api/agent/interview` |

## A.2 接口契约

```
POST /api/agent/interview
Content-Type: application/json
Payment-Proof: <base64>        # 首次请求不带，付款后带

{
  "job_title": "产品经理",
  "company": "字节跳动",
  "topic": "如何提升社区产品的次日留存",
  "format": "lgd",
  "roles": ["product_legend", "strategy_consultant", "brand_director"],
  "duration_minutes": 25
}
```

| 字段 | 必填 | 取值 |
| --- | --- | --- |
| `job_title` | 是 | 任意字符串，≤64 |
| `company` | 是 | 任意字符串，≤64 |
| `topic` | 否 | ≤200；不传则按岗位自动出题 |
| `format` | 否 | `lgd`（默认）\| `panel` |
| `roles` | 否 | 角色 id 数组，≤5 个；不传则自动配 |
| `duration_minutes` | 否 | `15` \| `25`（默认）\| `40` |

## A.3 402 时序

```
1. POST /api/agent/interview            （不带 Payment-Proof）
   ← 402 Payment Required
     amtPaymentLink: amtpp_v1_xxxx      ← 响应头，预下单号
     { amount, goods_name, out_trade_no, pay_before, amt_payment_link }

2. 智能体把预下单号交给支付宝，用户确认付款

3. POST /api/agent/interview            （带 Payment-Proof）
   ← 200 OK
     { service, out_trade_no, trade_no, amount, cached, result }
```

`result` 结构：

```json
{
  "topic": "讨论题目",
  "roles": [{ "id": "...", "name": "...", "stance": "..." }],
  "transcript": [{ "round": 1, "speaker": "...", "content": "..." }],
  "report": {
    "overall_score": 82,
    "dimensions": [{ "name": "...", "score": 85, "evidence": "...", "advice": "..." }],
    "highlights": ["..."],
    "improvements": ["..."]
  }
}
```

## A.4 环境变量

```
ALIPAY_AGENT_SERVICE_ID=API_67A60134AB7A4BCE
ALIPAY_AGENT_PRICE=3.00
ALIPAY_AGENT_GOODS_NAME=AI 群面模拟
```

`ALIPAY_AGENT_PRICE` **必须与注册时填的单价完全一致**，否则用户无法支付。

## A.5 安全与幂等

| 机制 | 作用 |
| --- | --- |
| 请求体规范化哈希 | 同一请求 30 分钟内复用同一笔未支付订单，智能体重试不重复扣费 |
| `order.request_hash` 比对 | 凭证必须对应「本次请求」的订单，防止拿便宜订单的凭证换贵资源 |
| 金额比对 | 凭证金额必须等于服务单价 |
| `result_json` 回放 | 同一凭证重复调用直接返回已交付结果，不重复烧 LLM |
| `active` 校验 | 支付宝返回 `active=true` 才算付款有效 |

## A.6 联调

```bash
# 1. 不带凭证 → 应该拿到 402 + amtPaymentLink
curl -i -X POST https://www.groupinterview.online/api/agent/interview \
  -H 'Content-Type: application/json' \
  -d '{"job_title":"产品经理","company":"字节跳动"}'

# 2. 付款后带凭证 → 应该拿到 200 + result
curl -i -X POST https://www.groupinterview.online/api/agent/interview \
  -H 'Content-Type: application/json' \
  -H 'Payment-Proof: <base64>' \
  -d '{"job_title":"产品经理","company":"字节跳动"}'
```

## A.7 代码位置

| 文件 | 作用 |
| --- | --- |
| `api/_lib/agentPay.ts` | 402 协议：预下单、凭证验证、Payment-Proof 解析、请求指纹 |
| `api/_lib/agentInterview.ts` | 业务实现：校验 → 402 → 验证 → 跑模拟 → 回放 |
| `api/pay.ts` | 统一入口，`action=agent-interview` 分发（Vercel 12 函数上限） |
| `tests/agent-pay.test.ts` | 15 条测试：配置、指纹、凭证解析、四条端点主路径 |

> 为什么不是独立文件：`api/` 下每个 `.ts` 都是一个 Vercel 函数，Hobby 档上限 12 个。
> 对外路径仍是 `/api/agent/interview`，Vercel 走 `vercel.json` rewrite，
> 本地 dev / ECS 走路由表 + `actionOf()` 按 URL 识别。
