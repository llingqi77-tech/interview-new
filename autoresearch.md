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
- R1（87）：纯逻辑地基一次铺完 —— scoring / phaseScripts / beep / inputMode / speakingRight / trajectory /
  privacy / reportCopy / setupValidation / roster / scheduler / summaryIntent / discussionPlan / panelTurn /
  deviceCheck + topicBank / interviewers / generateCandidates。**教训**：heredoc 单条命令上限约 7KB，超了会被静默截断。
- R2（108）：phaseEngine 双模式重写（LGD 3/4/15/3min + Panel 1/9/2min、1 分钟提醒、收尾提示、跳过 AI 自我介绍、
  beep 元数据、transitionKey）+ prompts。**教训**：旧 panel 复用 LGD 阶段 id，改 id 后 controller 的 panel 分支要同步；
  `tickPhase` 的 time_warning 会让 `changed=true`，测试不能断言 `changed===false`。
- R3（123）：reportEngine 双模式重写（8/9 维、规则+语义融合、证据池、分数段、权重分摊、主动总结加分）+
  ReportView + 摘掉付费墙。**教训**：`ReportV15` 换 `InterviewReport` 要连带改 analyze/feedback/certificate/geminiService。
- R4（154）：三个大组件接线 + RoomStage 容器 + App 全流程重写 + 引导语播报/提示音/总结意图接线 + 超时降级。
  **教训（最重要）**：检查体全绿时浏览器实测仍暴露 4 个真 bug —— getUserMedia 无超时卡在「检测中」、
  createSession 无超时卡在设备页、摄像头默认开启导致无法进入、结束按钮走成退出而不是出报告。
  **结论：组件级检查不能替代真实浏览器走查。**
- R5（167）：单面 STAR 即时出题接线、证据定位弹层、ASR 按键说话接线、删除旧房间组件。
  **教训**：删组件会连带打掉旧测试的断言目标，必须同步改到新组件；ASR 去重逻辑原本在 DiscussionPanel，
  删掉后要在 RoomStage 重建。
- R6（171）：修 3 个浏览器实测暴露的致命 bug —— 服务端 `resolveReplyCard` 只认 12 张静态卡导致每次 AI 发言 400、
  LLM 失败无兜底导致讨论中断、单面侧边栏面试官重复。加 `engine/fallbackLines.ts`。
  **教训**：DeepSeek 账户 402 余额不足，AI 发言必然失败 —— 这反而验证了降级链路。
- R7（175）：收尾引导语 + 1 分钟提醒接线、移动端题目/角色抽屉、题库要点贯通 controller、README 按 PRD 重写。

## 已知环境限制

- DeepSeek 账户余额不足（402），LLM 语义分路径未实测；报告走本地规则引擎，AI 发言走兜底台词。
- 本机无麦克风/摄像头，realtime 全双工与视觉维度未在浏览器实测；ASR/文字路径已验证。
- 部署域名 groupinterview.online 只写进配置，未实际部署。
