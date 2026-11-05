# 待办想法（未排期）

- **移动端布局实测**：InterviewRoom 的侧边栏在 <768px 隐藏，但移动端没有替代的题目/角色卡入口；PRD 要求移动端可用。需要加一个底部抽屉或折叠面板。
- **报告证据定位的滚动高亮**：现在点证据弹层展示上下文，但房间已关闭，无法滚动到原气泡。若要「定位到对应发言」更彻底，需要在报告页内嵌一份只读转写列表并滚动高亮。
- **权重按岗位族/职级配置的 UI**：`weightsFor` 已支持 jobFamily/level/overrides，但配置页没有暴露入口。PRD 说「支持按岗位类型与职级配置」，可加一个高级设置面板。
- **LGD 自由讨论的要点跟踪**：`keyPoints` 已贯通到房间侧边栏，但 `KeyPointTracker` 仍用旧的 `extractKeyPoints` 从题目文本抽要点，没有用题库里的 `keyPoints` 字段。应改为优先用题库要点。
- **AI 候选人发言的差异化**：现在三个候选人的 persona 是固定三套模板（结构化/质疑型/务实型），可以按岗位族再细分。
- **StepFun Realtime 全双工实测**：本机没有麦克风，realtime 通道未在浏览器里跑通过；只有 ASR/文字路径验证过。
- **报告生成 ≤20 秒的实测**：DeepSeek 账户余额不足，报告走的是本地规则引擎兜底；LLM 语义分路径未实测。
- **`docs/` 目录里的旧文档**（realtime-duplex-design.md、avatar-3d-assets.md、monad-onchain.md）描述的是旧架构，需要按新架构重写或归档。
- **`api/_lib/payStore.ts` / `api/pay.ts` / `src/pay.ts` / `src/onchain/*`**：付费墙 UI 已摘掉，但支付后端与链上铸证仍在。铸证保留在报告页；支付后端目前是死代码，可整体删除。
