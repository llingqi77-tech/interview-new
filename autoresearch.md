# Autoresearch: 面试模拟器 PRD 一致性

## Objective

把仓库里现有的「群面模拟器」（LGD 单模式、5 维报告、10 秒审题）**破坏性重构**成
`C:\Users\Administrator\Downloads\面试模拟器 PRD.md` 定义的 **LGD Simulator**：

- 纯前端 SPA，无注册登录、无付费墙，打开即用（域名 groupinterview.online）
- 四段式状态机 IDLE → PREPARING → DISCUSSING → FINISHED
- 两种模式：无领导小组讨论（LGD）+ 结构化单面（Panel）
- 阶段由倒计时驱动，每次切换由面试官用**固定引导语**串词（TTS + 字幕气泡 + 提示音）
- 面后报告：LGD 8 维 / Panel 9 维，百分制加权，证据引用可定位，改进建议编号列表

PRD 是唯一验收标准。历史实现（旧 5 维权重、旧阶段时长、旧 UI 文案）可以整体丢弃。

## Metrics

- **Primary**: `prd_pass`（条，higher is better）— PRD 一致性检查通过条数
- **Target**: 146（全部通过）
- **Secondary**: `prd_ratio`、各 area 的 `prd_<area>_pass`（product/setup/device/room/scripts/lgd/panel/report/scoring/privacy/stack）

## How to Run

`./autoresearch.sh` → `node scripts/prd-conformance.mjs`，输出 `METRIC prd_pass=N`。

检查体在 `tests/prd/*.mjs`，每条对应 PRD 里一条可验证需求。检查方式：

- 导入真实模块断言真实行为（阶段时长、权重、调度器分配、引导语原文、分数段…）
- 用 `react-dom/server` 渲染**真实组件**断言 DOM（`data-testid` / 文案 / 结构）
- 少量源码断言只用于「不该出现的东西」（无付费墙、无鉴权门、视觉 worker 无上传）

`scripts/prd-conformance.mjs` 用 esbuild 注册 Node loader hook，因此可以直接 import `.ts` / `.tsx`。

## Files in Scope

- `types.ts` — 类型与常量（状态机、题型、维度 id、阶段 id）
- `engine/*.ts` — 纯逻辑：阶段引擎、引导语、打分、调度器、报告、隐私、设备检测、轨迹、发言权、输入模式
- `data/*.ts` — 题库、面试官形象、候选人生成、角色卡
- `components/*.tsx` — SetupForm / DeviceCheck / InterviewRoom / ReportView
- `src/session/*` — 会话控制器（接线）
- `api/_lib/prompts.ts` — 主持/候选人/单面提问/分析 prompt
- `tests/prd/*.mjs` — 一致性检查（**只增不减，不得为了让指标变绿而放宽断言**）
- `tests/*.test.ts` — 项目自身测试（重构后同步更新，废弃的删掉）

## Off Limits

- `tests/prd/*.mjs` 的断言强度：可以修 bug（断言写错），不可以为了过而删检查或放宽阈值
- `.env*`、密钥、`api/_lib/payStore.ts` 等支付后端（UI 入口要摘掉，后端文件留着不动）
- `contracts/`、`indexer/`

## Constraints

- `tsc --noEmit` 必须通过
- `node --test tests/*.test.ts` 必须通过
- 不新增运行时依赖（esbuild 只用于检查脚本，走 node_modules/.pnpm 解析）
- 不联网、不调用真实 LLM/StepFun（检查全部离线）

## What's Been Tried

- 基线（fed9d2e）：`prd_pass=16/146`。旧实现只有 LGD 单模式、5 维报告（content/voice/visual/stress/teamwork）、
  审题 10 秒、无引导语模块、无题库、无 6 位面试官形象、无发言轨迹条、无环形倒计时。
