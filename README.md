<div align="center">

# 🎯 LGD Simulator · AI 面试练习

**纯前端单页应用。无注册登录、无付费墙，打开即可用。**

[![React](https://img.shields.io/badge/React-19.2.3-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.2-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2.0-646CFF?logo=vite)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.1.18-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)

生产域名：**groupinterview.online**

</div>

---

## 产品形态

四段式流程，任一时刻处于以下四个状态之一：

| 状态 | 环节 | 说明 |
|---|---|---|
| `IDLE` | 练习配置 | 填写公司/岗位，选择面试模式与题目类型或面试官，AI 生成题目 |
| `PREPARING` | 设备检测 | 麦克风 / 摄像头 / 扬声器 / 网络四连检，数据同意开关，流程预览 |
| `DISCUSSING` | 面试房间 | 倒计时驱动的分阶段模拟面试，可语音或文字参与、随时打断 |
| `FINISHED` | 面后报告 | 自动生成多维评估报告，可「再来一场」或删除本次记录 |

两种模式：

- **无领导小组讨论（LGD）**：1 位主持面试官 + 3 位 AI 候选人 + 你。审题 3min → 自我介绍每人 1min（共 4min）→ 自由讨论 15min → 总结陈词 3min。
- **结构化单面（Panel）**：2（或 3）位面试官 + 你。自我介绍 1min → 面试官问答 8-10min → 反问 2min。题目在你做完自我介绍后按目标岗位即时生成（STAR 结构化）。

## 打分机制

百分制：每个维度 0-100 子分 × 权重求和。分数段：≥90 优秀 / 80-89 良好 / 70-79 合格 / 60-69 待提升 / <60 重点改进。

| 群面维度 | 权重 | | 单面维度 | 权重 |
|---|---|---|---|---|
| 内容贡献 | 20% | | 岗位匹配度 | 25% |
| 团队协作 | 20% | | 综合分析能力 | 15% |
| 结构贡献 | 15% | | 行为与成果（STAR） | 15% |
| 领导与影响力 | 15% | | 沟通表达 | 10% |
| 抗压与冲突处理 | 10% | | 学习与成长潜力 | 10% |
| 沟通表达 | 10% | | 动机与价值观 | 10% |
| 语音表现 | 8% | | 抗压与应变 | 10% |
| 视觉表现 | 2% | | 反问质量 | 3% |
| | | | 语音与视觉表现 | 2% |

纯语音模式（跳过摄像头）不评估视觉维度，其权重按比例分摊至其余维度，总分仍为百分制。

## 技术栈

- **DeepSeek**：题目生成、角色发言、面后语义分析（全部经 `/api/llm` 服务端代理，key 仅存服务端）
- **StepFun**：ASR 语音识别、TTS 语音合成、Realtime 全双工语音（凭证由服务端短时签发）
- **浏览器 Web Speech API**：语音兜底
- **摄像头分析**：MediaPipe FaceLandmarker，全部在浏览器本地完成（0 字节上传）
- **数据存储**：默认本地模式（未配置数据库）；配置数据库后支持会话保存；原始音频/视频默认不保存

## 快速开始

```bash
pnpm install
cp .env.example .env.local   # 填入 DEEPSEEK_API_KEY / STEPFUN_API_KEY / DATABASE_URL
pnpm dev                     # http://localhost:3000
pnpm verify                  # 密钥扫描 + typecheck + 测试 + 构建 + bundle 检查
```

## 目录结构

```
engine/            纯逻辑：阶段引擎、引导语、打分、调度器、报告、隐私、设备检测、轨迹、发言权
data/              题库（4 类）、6 位面试官形象、AI 候选人生成、角色卡
components/        SetupForm / DeviceCheck / InterviewRoom / RoomStage / ReportView
src/session/       SessionController（会话编排）+ store + 落库队列
api/               /api/llm、/api/asr、/api/tts、/api/realtime-token、/api/session(s)、/api/analyze
tests/prd/         PRD 一致性检查（171 条，node scripts/prd-conformance.mjs）
```

## 验收

```bash
node scripts/prd-conformance.mjs   # PRD 一致性检查：171/171
pnpm typecheck && pnpm test        # 类型 + 322 条单元/集成测试
```

---

## 历史版本说明（v0.7-tow 及更早）
---

## 🆕 v0.7-tow 升级说明（语音化 + 真实计时 + 安全债清偿）

依据 `tododocs/lgd-prdword-tow.md`（v0.7-tow，v0.6 全量刷新）完成改造：

| 项 | v0.6（旧） | v0.7-tow（现在） |
|---|---|---|
| LLM 调用 | 前端直调 DeepSeek，**key 注入 bundle（D1 违反）** | 全部经 `/api/llm` 服务端代理，key 仅存服务端 env |
| 数据库凭据 | 4 个 `api/*.ts` 硬编码 RDS 账号密码（D2） | `DATABASE_URL` 环境变量，源码 0 明文凭据 |
| 登录死代码 | `api/auth.ts` + `login/admin` 页残留（D3） | 已删除；免登录 + 每场会话级记录 + 一键删除 |
| 阶段推进 | 关键词 + 25 轮上限（D4） | 倒计时四阶段主信号：审题 10s → 个人陈述每人 1min → 自由讨论 ≤15min → 总结 3min |
| 角色 | 3 个硬编码 | 12 张角色卡数据驱动（音色/形象/策略/性格约束分配） |
| 形象 | dicebear 静态 SVG | 12 预设形象库（≥8 行业）+ 说话高亮 + 音色绑定 |
| 发言权 | 洗牌队列 + 用户保护 | 调度 v1：B.3 打分公式 + B.5 打断规则 + B.6 用户保护，events 落库 |
| 语音 | 仅 Web Speech 输入，AI 文字回复 | StepFun TTS 播报（3 音色 + emotion）+ ASR 主路径 + Web Speech/文字兜底 + barge-in |
| 报告 | 4 文本字段 + 总分 | v1.5：维度分 + evidence 引用 + 规则引擎实算 + 事件时间轴 |
| 隐私 | 无 | 明确同意后保存转写/聚合特征；原始音视频不保存；删除本次记录 |
| 设备检测 | 无 | 麦克风/摄像头/扬声器/网络依次检测 + 移动端专项提示 |

### 快速开始

```bash
pnpm install
cp .env.example .env.local   # 填入 DEEPSEEK_API_KEY / STEPFUN_API_KEY / DATABASE_URL
pnpm dev                     # http://localhost:3000
pnpm verify                  # 密钥扫描 + typecheck + 测试 + 构建 + TC-00 bundle 检查
```

### 环境变量（仅服务端，前端 0 暴露）

| 变量 | 用途 | 未配置时行为 |
|---|---|---|
| `DEEPSEEK_API_KEY` | `/api/llm` 代理调用 DeepSeek | 题目/发言/报告不可用（界面提示降级） |
| `STEPFUN_API_KEY` | `/api/tts-token`、`/api/asr-token` 签发短时凭证 | 自动降级：Web Speech 输入 + 文字播报 |
| `DATABASE_URL` | 会话/消息/事件/报告落库 | 本地模式：不落库，模拟照常进行 |

### 数据库迁移

```bash
psql "$DATABASE_URL" -f db/migration-v0.7.sql
```

迁移内容（PRD 附录 D）：`simulation_sessions→sessions`（+roles JSONB 等）、`conversation_records→transcripts`（+时间戳/置信度）、`feedback_reports→reports`（+dimension_scores/evidence_pool/suggestions JSONB）、新增 `events`/`visual_features`/`avatars` 表与索引。**执行前务必完成 D1/D2 凭据轮换（旧凭据视为已泄露）**。

### API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/llm` | DeepSeek 代理：`topic`/`reply`/`feedback`/`analyze`，SSE 流式，服务端限流 |
| POST | `/api/tts-token` · `/api/asr-token` | StepFun 短时凭证签发（前端不持 key） |
| POST/GET | `/api/events` | 发言权调度事件日志 |
| POST/GET/PUT/DELETE | `/api/session` | 会话管理（DELETE 级联删除全部记录） |
| POST/GET | `/api/message` | 转写落库（transcripts） |
| POST/GET | `/api/feedback` | 报告落库（reports JSONB） |
| GET/DELETE | `/api/sessions/{id}` | 会话详情 / 删除（隐私，TC-11） |
| POST | `/api/sessions/{id}/analyze` | 触发面后分析（规则引擎 + LLM） |
| GET | `/api/sessions/{id}/report` | 报告 v1.5 |
| POST/GET | `/api/sessions/{id}/visual` | 视觉聚合特征批量入库 / 查询（每秒一条，M6） |
| GET/DELETE | `/api/avatars/presets` · `/api/avatars?id=` | 预设形象 / 删除上传形象 |

### 验证与质量门

```bash
pnpm check:secrets   # D1/D2 源码回归：无硬编码 key/凭据
pnpm test            # 200 个 node:test 用例（含 API/语音/隐私/接线集成测试）：阶段引擎/调度/角色分配/报告引擎/代理集成
pnpm check:bundle    # TC-00：构建产物无任何 key/凭据
```

逐项测试审计报告见 [docs/test-audit.md](docs/test-audit.md)（附录 H 的 TC-00~TC-15、C1~C10、8.2、US-01~16 全覆盖）。

### M6 视觉维度（摄像头本地分析）

摄像头画面在**浏览器本地**用 MediaPipe Face Landmarker 推理（`@mediapipe/tasks-vision@1.1.1`，Web Worker 内运行），
只把每秒一条的聚合特征（眼神接触 / 情绪 / 头部姿态 / 参与度）写入 `visual_features`，**原始视频 0 字节上传**（PRD C3/C4）。

- 模型与 wasm 随站点同源分发，不进 JS bundle：`public/vision/face_landmarker.task` + `public/vision/wasm/*`
  （从 `node_modules/@mediapipe/tasks-vision/wasm` 拷贝，版本 1.1.1；升级依赖时需同步刷新这两个目录）
- 采样帧率：桌面 4fps / 移动端（或 ≤4 核）2fps，聚合固定 1Hz；标签页隐藏时暂停采样
- 评分：眼神接触 40% / 情绪稳定性 30% / 头部姿态 20% / 参与度 10%，维度满分 20%，计入综合分
  （权重常量集中在 `engine/reportEngine.ts` 的 `FINAL_WEIGHTS`；摄像头关闭/数据不足 <30 秒时走 `TRANSITION_WEIGHTS`，视觉维度显示「未开启」）
- 面试中静默采集，不做任何实时提示；结果只在面后报告呈现

其余 P1/P2（LiveKit 实时房间、viseme 口型、报告追问等）按 PRD §4.2/§4.3 排期，不在本期范围。
---

## 📸 产品首页

<div align="center">

![产品首页](./screenshots/homepage.jpg)
</div>

---

## 📖 产品介绍

**群面模拟器** 是一款基于 AI 驱动的无领导小组讨论面试模拟平台，专为求职者设计，帮助他们在真实的群面环境中练习和提升面试技巧。

### 🎯 产品定位

- **目标用户**：准备校招群面面试的求职者
- **核心价值**：提供接近真实的群面环境，让求职者在实战中提升面试能力
- **差异化优势**：AI 驱动的多角色互动 + 实时反馈分析

### ✨ 核心功能

#### 1. 🧠 AI 智能题目生成
- 根据公司和岗位自动生成高质量群面题目
- 包含背景、任务、要求、时间分配等完整要素
- 模拟真实大厂面试题目风格

#### 2. 👥 多角色 AI 讨论伙伴
系统内置 3 个不同性格的 AI 角色，模拟真实群面场景。

#### 3. 💬 实时讨论模拟
- 支持文本输入和语音识别
- 动态讨论阶段识别（开局框架 → 深入讨论 → 总结引导 → 收尾补充）
- 智能发言平衡机制，避免 AI 角色过度发言
- 抢话检测和高压场景模拟

#### 4. 📊 AI 智能反馈分析
面试结束后，系统会生成详细的评估报告：

- **发言时机分析**：评估切入时机的精准度
- **话语权占比**：统计发言频率和占比
- **结构贡献评估**：分析对讨论框架的贡献
- **抗压能力评价**：评估在冲突和高压下的表现
- **综合评分**：0-100 分的整体表现评分
- **改进建议**：3-5 条具体的优化建议

---

## 🏗️ 技术架构

### 前端技术栈

```
┌─────────────────────────────────────────────────────────┐
│                     前端应用层                            │
├─────────────────────────────────────────────────────────┤
│  React 19.2.3  │  TypeScript 5.8.2  │  Vite 6.2.0      │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    UI 组件层                              │
├─────────────────────────────────────────────────────────┤
│  • SetupForm (题目设置)                                   │
│  • DiscussionPanel (讨论面板)                            │
│  • FeedbackReport (反馈报告)                              │
│  • CharacterCard (角色卡片)                               │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   样式系统                                │
├─────────────────────────────────────────────────────────┤
│  Tailwind CSS 4.1.18  │  PostCSS  │  Autoprefixer      │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   服务层                                  │
├─────────────────────────────────────────────────────────┤
│  geminiService.ts (AI 服务封装)                           │
│  • generateTopic() - 生成题目                            │
│  • generateAIReply() - 生成 AI 回复                      │
│  • generateFeedback() - 生成反馈报告                      │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   AI 服务层                               │
├─────────────────────────────────────────────────────────┤
│  DeepSeek API (deepseek-chat)                           │
│  • Chat Completions API                                 │
│  • 模型: deepseek-chat                                  │
│  • 温度参数: 0.3-0.8 (根据场景调整)                      │
└─────────────────────────────────────────────────────────┘
```

### 技术选型说明

| 技术 | 版本 | 用途 | 选择理由 |
|------|------|------|----------|
| **React** | 19.2.3 | UI 框架 | 成熟的组件化开发，丰富的生态系统 |
| **TypeScript** | 5.8.2 | 类型系统 | 提供类型安全，提升代码可维护性 |
| **Vite** | 6.2.0 | 构建工具 | 极速的开发体验，快速的 HMR |
| **Tailwind CSS** | 4.1.18 | CSS 框架 | 原子化 CSS，快速构建现代 UI |
| **DeepSeek API** | latest | AI 服务 | 高性能中文对话模型，成本效益高 |

### 项目结构

```
interview-second-main/
├── components/              # React 组件
│   ├── SetupForm.tsx       # 题目设置表单
│   ├── DiscussionPanel.tsx # 讨论面板（核心）
│   ├── FeedbackReport.tsx  # 反馈报告
│   └── CharacterCard.tsx   # 角色卡片
├── services/                # 服务层
│   └── geminiService.ts    # AI 服务封装
├── types.ts                 # TypeScript 类型定义
├── constants.ts             # 常量配置（角色、提示词）
├── App.tsx                  # 主应用组件
├── index.tsx                # 应用入口
├── vite.config.ts           # Vite 配置
├── tailwind.config.js        # Tailwind 配置
└── package.json             # 项目依赖
```

## 📦 部署

### GitHub Pages 部署

快速部署到 GitHub Pages，免费且简单：

**⚠️ 遇到部署错误？** 查看 [快速配置指南](./GITHUB_PAGES_SETUP.md)

详细部署指南请查看 [GitHub Pages 部署文档](./DEPLOY_GITHUB_PAGES.md)

**快速步骤：**
1. 在仓库 Settings → Pages 中启用 GitHub Pages
2. **重要**：选择 "GitHub Actions" 作为部署源（不是 "Deploy from a branch"）
3. 在 Secrets 中添加 `DEEPSEEK_API_KEY`
4. 推送代码到 `main` 分支，自动部署

### Vercel 部署（推荐）

详细部署指南请查看 [Vercel 部署文档](./DEPLOY_VERCEL.md)

### 中国大陆部署

如需部署到中国大陆可访问的网站，请查看 [国内部署指南](./DEPLOY_CN.md)

支持以下部署方案：
- 阿里云 OSS + CDN
- 腾讯云 COS + CDN
- 自建服务器 + Nginx

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

---

## 📄 许可证

本项目采用 MIT 许可证。详情请查看 [LICENSE](./LICENSE) 文件。

---

## 🙏 致谢

- [DeepSeek](https://www.deepseek.com/) - 提供强大的 AI 对话能力
- [React](https://react.dev/) - 优秀的 UI 框架
- [Vite](https://vitejs.dev/) - 极速的开发体验
- [Tailwind CSS](https://tailwindcss.com/) - 优雅的 CSS 框架

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给个 Star！**

Made with ❤️ by [llingqi77-tech](https://github.com/llingqi77-tech)

</div>
