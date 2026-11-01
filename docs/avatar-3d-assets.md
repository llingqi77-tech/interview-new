# 角色 3D 资产（文生 3D）

> 回答「有多少个角色用文生 3D 模型」：**13 个**。
> 12 张候选人角色卡（`data/roleCards.ts`）+ 1 张主持面试官卡（`data/interviewerCards.ts`），
> 每个角色在 `data/avatars.ts` 里有一个唯一 `AvatarPreset`，也各有一份文生 3D 模型。

## 1. 角色与模型的对应关系

| # | 角色 | 角色卡 id | 形象 id | 3D 模型 | 性别/年龄（美术设定） |
|---|---|---|---|---|---|
| # | 角色（角色卡名） | 形象 id | 形象名 | 3D 模型 | 性别/年龄（美术设定） |
|---|---|---|---|---|---|
| 1 | 科技远见者 | `visionary_01` | 远见者 | `public/avatars/3d/visionary_01.glb` | 男 · 30 出头 |
| 2 | 产品传奇 | `legend_01` | 传奇产品人 | `.../legend_01.glb` | 男 · 40 出头 |
| 3 | 供应链大师 | `master_01` | 供应链大师 | `.../master_01.glb` | 男 · 50 上下 |
| 4 | 加密先锋 | `pioneer_01` | 加密先锋 | `.../pioneer_01.glb` | 男 · 20 末 |
| 5 | 价值投资者 | `investor_01` | 价值投资者 | `.../investor_01.glb` | 男 · 60 上下 |
| 6 | 投行分析师 | `analyst_01` | 投行分析师 | `.../analyst_01.glb` | 女 · 30 出头 |
| 7 | 战略顾问 | `consultant_01` | 战略顾问 | `.../consultant_01.glb` | 女 · 30 多岁 |
| 8 | 品牌总监 | `brand_01` | 品牌总监 | `.../brand_01.glb` | 女 · 20 末 |
| 9 | 运营总监 | `ops_01` | 运营总监 | `.../ops_01.glb` | 男 · 40 出头 |
| 10 | 行业专家 | `expert_01` | 行业专家 | `.../expert_01.glb` | 女 · 50 上下 |
| 11 | 招聘经理 | `hr_01` | 招聘经理 | `.../hr_01.glb` | 女 · 20 末 |
| 12 | 技术面试官 | `tech_01` | 技术面试官 | `.../tech_01.glb` | 男 · 30 出头 |
| 13 | 主持面试官 | `host_01` | 主持面试官 | `.../host_01.glb` | 男 · 30 末 |

> 「角色卡名」与「形象名」有 2 处不同（远见者 vs 科技远见者、传奇产品人 vs 产品传奇）——
> 这是仓库既有设定，角色卡是角色身份，预设形象是形象标签，不是笔误。

**每场上场几个模型**（模型都在，只是同时渲染的少）：
- `lgd` 群面阵型：3 个 AI 候选人角色 + 1 位主持面试官 = 4 个模型在场
  （角色分配规则见 `engine/roleSelector.ts` 的 `autoSelectRoles`）。
- `panel` 结构化单面：2 或 3 位面试官 + 主持 = 3~4 个模型在场
  （`autoSelectPanel`）。
- 13 份模型覆盖全部可能出场组合，形象与音色都不重复（`validateSelection` / `validatePanelSelection` 守这条）。

## 2. 资产规格

| 项 | 值 |
|---|---|
| 生成引擎 | Hyper3D Rodin Gen-2.5（`hyper3d` CLI / MCP `rodin_generate`） |
| 档位 | `Gen-2.5-Medium`（Raw mesh，`quality_override=30000`） |
| 绑骨 | Human 骨架（52 关节）+ `Human/standing_idle` 动画 clip |
| 贴图 | Rodin 出的是 2048² PNG → 产线转 **WebP**（`EXT_texture_webp`） |
| 单个体积 | ~2.3MB（优化前 8~9MB） |
| 三角面 | ~19.6k 顶点 / 角色 |
| 风格 | 哑光黏土手办风（与现有 DiceBear SVG 形象同一调性，C7：不用真实名人肖像） |

清单文件：`data/avatarModels.ts`（**生成物，别手改**），
类型 `AvatarModelEntry` 在 `types.ts`。美术设定与提示词：`data/avatar3dCharacters.ts`（手写）。

## 3. 产线命令

```bash
# 0. 预演（零 credit）：打印 13 个角色的计划 + 钱包余额
node scripts/gen-avatar-models.mjs

# 1. 生成（付费；不加 --yes 会打印余额与计划后 exit 3）
node scripts/gen-avatar-models.mjs --run --yes

# 只跑某几个角色 / 并行分批
node scripts/gen-avatar-models.mjs --run --yes --ids analyst_01,hr_01 --no-manifest

# 2. 贴图 PNG → WebP（也可以单独跑）
node scripts/optimize-avatar-glb.mjs --run --dir public/avatars/3d

# 3. 只重建清单（从 state.json 汇总，零 credit）
node scripts/gen-avatar-models.mjs --manifest

# 4. 检视：浏览器打开 public/avatars/3d/viewer.html（three.js 检视台）
#    截图（headless Chrome）：存 docs/screenshots/
node scripts/shoot-avatar-models.mjs
node scripts/shoot-avatar-models.mjs --id host_01 --out docs/screenshots/avatar-3d-host.png
```

**成本**：生成 0.5 credits/次 + 绑骨 0.5 credits/次 = **1 credit/角色**。
13 个角色整批 = 13 credits；本次实际总消耗 **18.5 credits**（多出的 5.5 是重做：
远见者/技术面试官两个角色各重做 1~3 次 + 一次提示词改版）。

`data/avatarModels.ts` 里的 `credits` 字段是「该角色处理期间的钱包净变化」——
并行跑多个角色时钱包共享，这个值会串账（可能大于真实成本），以钱包前后差额为准。

**断点续跑**：每个角色一份 `tripo-out/avatars/<id>/state.json`（generation id / rigging id / 落地路径 / 实际扣费）。
中断后重跑接着走，**不会重复计费**。`tripo-out/` 不入库（`.gitignore`）。

## 4. 改美术设定

只改 `data/avatar3dCharacters.ts`：

- `STYLE_BASELINE`：13 个角色共用的风格段（改这里等于整组换风格）。
- `PROMPT_CONSTRAINTS`：构图与内容约束（单角色、无文字、水印等）。
- 每个角色 6 段：`subject`（人物）/ `hair`（发型）/ `outfit`（服装）/ `accessory`（配饰）/ `expression`（表情姿态）。
- 提示词必须全 ASCII（Rodin 对中文还原很差），`tests/avatar-3d-assets.test.ts` 会守住这条。

改完重跑生成（**会重新计费**，旧模型可从 `tripo-out/avatars/<id>/raw.glb` 找回）。

## 5. 这次没有做的事（明确边界）

- **没有做运行时 3D 场景**。本仓库只产出资产。面试间里的 R3F 场景、VRM/GLB 加载、
  口型驱动、说话高亮属于 `tododocs/m7-immersive-3d-realtime-plan.md` 的 Phase 3，
  本次不在范围内（仓库当前的 `components/AvatarStage.tsx` 仍是 DiceBear SVG）。
- **没有做表情 / 口型 morph**。Rodin 的 Human 骨架带 idle 动画 clip，不含 ARKit blendshape；
  口型驱动方案见 M7 计划 D3（Web Audio 频谱 → viseme）。
- **没有做减面 / Draco**。当前 19.6k 顶点的角色模型单文件 ~2.3MB，直接可用；
  真的进首屏再按需上 Draco（需要运行时配 DRACOLoader）。

## 6. 踩过的坑（下次直接抄）

1. **CLI 令牌过期后自己 refresh 会失败**：CLI 内置 refresh 会在请求里带 `resource`/`scope`，
   服务端回 `invalid_target` → CLI 一直超时。`scripts/hyper3d.mjs` 里改成**只发最小参数集**
   （`grant_type` + `client_id` + `refresh_token`）就能换到新令牌（有效期 1 小时）。
2. **必须直连，不要走本机 10808 代理**：`api.hyper3d.com` 直连可达，走代理反而卡死。
   `scripts/hyper3d.mjs` 默认清掉 `HTTPS_PROXY`/`NODE_USE_ENV_PROXY`，只有显式给
   `HYPER3D_PROXY` 才注入代理。
3. **`rodin_generate` 是阻塞调用**：返回即生成完成（中等档位实测 2~4 分钟）。
   中途不要重投；任务 id 在返回体的 `generation_id` 字段里。
4. **Rodin 出的是 PNG 贴图**：三张 2048² PNG = 6.8MB。用 `scripts/optimize-avatar-glb.mjs`
   转 WebP（走 `EXT_texture_webp` 扩展），单个模型 9MB → 2.3MB。
   注意 `gltf-transform webp` 在这批资产上会报 "colourspace: parameter space not set"，用不了。
5. **重写 GLB 的 BIN 块时注意 4 字节对齐**：bufferView 起点要对齐，否则访问器的对齐要求会被破坏。
6. **提示词里的「半身像」要给干净的裁切描述**：写 "bust sculpture cropped cleanly just below
   the shoulders with a flat smooth base, no ragged edges" 才不会出撕裂的下边缘。
