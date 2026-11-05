import assert from 'node:assert/strict';
import { render, contains, load, need } from './_helpers.mjs';

const area = 'room';

const role = (id, name) => ({
  id, name, industry: '互联网',
  persona: { traits: ['理性'], speaking_style: '简洁', conflict_strategy: '协商', cooperation_level: 0.6, leadership_tendency: 0.5, conflict_level: 'medium' },
  voice: { provider: 'stepfun', voice_id: 'v-' + id, rate: 1, emotion_default: 'neutral' },
  avatar: { preset_id: 'p1', emotion_set: ['neutral'] },
  behavior: { speak_probability: 0.5, interrupt_probability: 0.2, avg_speak_duration: 30, response_to_challenge: 'defend', summary_tendency: 0.3 },
  background: { education: '硕士', major: '金融学', internship: '字节跳动 产品实习' },
});

const fixture = () => ({
  format: 'lgd',
  phase: { id: 'FREE_DISCUSSION', label: '自由讨论', index: 2, total: 4, remainingMs: 8 * 60 * 1000, progress: 0.47, description: '围绕题目要点深入讨论，最后 3 分钟收尾' },
  topic: '某公司要在三个城市中选一个开新仓，请给出方案',
  keyPoints: ['成本', '时效', '风险'],
  messages: [
    { id: 'm1', senderId: 'user', senderName: '我', content: '我先给个框架', timestamp: 1000, type: 'message', startMs: 0, endMs: 3000, source: 'text' },
    { id: 'm2', senderId: 'c1', senderName: '林清', content: '我同意你的框架', timestamp: 5000, type: 'message', startMs: 4000, endMs: 8000, emotion: 'neutral', source: 'llm' },
  ],
  roles: [role('c1', '林清'), role('c2', '周野'), role('c3', '苏芮')],
  interviewers: [{ id: 'host', name: '陈锋', archetype: '科技远见者', title: '产品总监', company: '字节跳动', level: 'director', yearsExperience: 9, jobFamilies: ['tech'], avatar: 'visionary', voiceId: 'v-host', role: 'host' }],
  speakingRight: { kind: 'ai_speaking', label: '林清 正在发言，可随时抢话', speakerName: '林清', canBargeIn: true },
  trajectory: { points: [{ speakerId: 'user', speakerName: '我', isUser: true, startMs: 0, durationMs: 3000 }, { speakerId: 'c1', speakerName: '林清', isUser: false, startMs: 4000, durationMs: 4000 }], total: 2 },
  inputMode: 'realtime',
  thinking: false,
  streaming: true,
  muted: false,
  cameraOn: true,
  textInputOpen: false,
  degraded: null,
  onSend() {}, onBargeIn() {}, onToggleMute() {}, onToggleCamera() {},
  onToggleTextInput() {}, onEnd() {}, onViewTopic() {}, onSkipAiIntro() {},
});

export const checks = [
  {
    id: 'R1', area, title: '顶部状态栏显示当前阶段名',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      contains(render(C, fixture()), '自由讨论');
    },
  },
  {
    id: 'R2', area, title: '顶部状态栏有阶段进度条',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      const html = render(C, fixture());
      assert.ok(/data-testid="phase-progress"/.test(html), '缺少阶段进度条');
    },
  },
  {
    id: 'R3', area, title: '顶部状态栏有环形倒计时',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      const html = render(C, fixture());
      assert.ok(/data-testid="countdown-ring"/.test(html), '缺少环形倒计时');
      contains(html, '08:00');
    },
  },
  {
    id: 'R4', area, title: '顶部状态栏可查看题目',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      contains(render(C, fixture()), '题目');
    },
  },
  {
    id: 'R5', area, title: '顶部状态栏有结束按钮',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      contains(render(C, fixture()), '结束');
    },
  },
  {
    id: 'R6', area, title: '用户发言在右侧并标记「我」',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      const html = render(C, fixture());
      assert.ok(/data-side="right"/.test(html), '用户气泡未右对齐');
      contains(html, '>我<');
    },
  },
  {
    id: 'R7', area, title: 'AI 发言在左侧，带头像/姓名/情绪标签/时间',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      const html = render(C, fixture());
      assert.ok(/data-side="left"/.test(html), 'AI 气泡未左对齐');
      contains(html, '林清', 'data-emotion', 'data-time');
    },
  },
  {
    id: 'R8', area, title: 'AI 发言流式输出',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      const html = render(C, fixture());
      assert.ok(/data-streaming="true"/.test(html), '缺少流式输出标记');
    },
  },
  {
    id: 'R9', area, title: 'AI 思考时显示「思考中」',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      const html = render(C, { ...fixture(), thinking: true, streaming: false });
      contains(html, '思考中');
    },
  },
  {
    id: 'R10', area, title: '发言轨迹条：最近 50 次发言 + 发言总数',
    async run() {
      const m = await load('engine/trajectory.ts');
      need(m, 'buildTrajectory', 'TRAJECTORY_WINDOW');
      assert.equal(m.TRAJECTORY_WINDOW, 50);
      const many = Array.from({ length: 80 }, (_, i) => ({
        id: 'm' + i, senderId: i % 2 ? 'c1' : 'user', senderName: i % 2 ? '林清' : '我',
        content: 'x', timestamp: i * 1000, type: 'message', startMs: i * 1000, endMs: i * 1000 + 500,
      }));
      const t = m.buildTrajectory(many);
      assert.equal(t.points.length, 50);
      assert.equal(t.total, 80);
      const C = await load('components/InterviewRoom.tsx');
      const html = render(C, fixture());
      assert.ok(/data-testid="trajectory-bar"/.test(html), '缺少发言轨迹条');
      contains(html, '发言总数');
    },
  },
  {
    id: 'R11', area, title: '发言权提示四态',
    async run() {
      const m = await load('engine/speakingRight.ts');
      need(m, 'speakingRightOf');
      assert.equal(m.speakingRightOf({ userHasFloor: true }).label, '当前发言权在你手中');
      assert.equal(m.speakingRightOf({ speakingName: '林清' }).label, '林清 正在发言，可随时抢话');
      assert.equal(m.speakingRightOf({ thinking: true }).label, 'AI 正在思考');
      assert.equal(m.speakingRightOf({}).label, '等待调度器分配');
    },
  },
  {
    id: 'R12', area, title: '输入方式四级降级链：全双工语音 → ASR → 浏览器语音 → 文字',
    async run() {
      const m = await load('engine/inputMode.ts');
      need(m, 'INPUT_MODE_CHAIN', 'resolveInputMode');
      assert.deepEqual([...m.INPUT_MODE_CHAIN], ['realtime', 'asr', 'webspeech', 'text']);
      assert.equal(m.resolveInputMode({ realtime: true, asr: true, webSpeech: true }), 'realtime');
      assert.equal(m.resolveInputMode({ realtime: false, asr: true, webSpeech: true }), 'asr');
      assert.equal(m.resolveInputMode({ realtime: false, asr: false, webSpeech: true }), 'webspeech');
      assert.equal(m.resolveInputMode({ realtime: false, asr: false, webSpeech: false }), 'text');
    },
  },
  {
    id: 'R13', area, title: '底部工具条：静音 / 摄像头 / 语音输入 / 打断 AI / 文字输入',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      const html = render(C, fixture());
      contains(html, '静音', '摄像头', '语音输入', '打断', '文字输入');
    },
  },
  {
    id: 'R14', area, title: '侧边栏：题目与当前讨论要点',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      const html = render(C, fixture());
      contains(html, '讨论要点', '成本', '时效');
    },
  },
  {
    id: 'R15', area, title: '侧边栏角色卡：发言者高亮',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      const html = render(C, fixture());
      assert.ok(/data-speaking="true"/.test(html), '发言角色未高亮');
      contains(html, '周野', '苏芮');
    },
  },
  {
    id: 'R16', area, title: '侧边栏展示面试官形象',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      const html = render(C, fixture());
      contains(html, '陈锋', '科技远见者');
    },
  },
  {
    id: 'R17', area, title: '侧边栏展示阶段说明',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      contains(render(C, fixture()), '围绕题目要点深入讨论');
    },
  },
  {
    id: 'R18', area, title: '降级保护：LLM/语音异常时提示且讨论可继续',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      const html = render(C, { ...fixture(), degraded: '语音服务异常，已切换为文字输入' });
      contains(html, '已切换为文字输入');
    },
  },
  {
    id: 'R19', area, title: '每个小阶段都有倒计时提示音',
    async run() {
      const m = await load('engine/beep.ts');
      need(m, 'beepCuesFor', 'BEEP_KINDS');
      const cues = m.beepCuesFor({ durationMs: 180000, warningMs: 60000 });
      assert.ok(cues.some((c) => c.kind === 'warning'), '缺少结束前 1 分钟提示音');
      assert.ok(cues.some((c) => c.kind === 'end'), '缺少到点提示音');
      assert.ok(cues.every((c) => typeof c.atMs === 'number'));
    },
  },
  {
    id: 'R21', area, title: '移动端：侧边栏隐藏时提供题目/角色抽屉',
    async run() {
      const C = await load('components/InterviewRoom.tsx');
      const html = render(C, fixture());
      assert.ok(/data-testid="mobile-panel-toggle"/.test(html), '缺少移动端抽屉入口');
      assert.ok(/md:hidden/.test(html), '移动端抽屉未按断点控制');
    },
  },
  {
    id: 'R20', area, title: '阶段切换同步触发提示音与状态栏阶段名更新',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      need(p, 'tickPhase');
      const cfg = { durationsMs: { READING: 1000 } };
      const s0 = p.initPhaseEngine(0, 'lgd', cfg);
      const r = p.tickPhase(s0, 1500, 'lgd', cfg, 0);
      assert.ok(r.changed, '到点未切换');
      const ev = r.events.find((e) => e.event_type === 'stage_change');
      assert.ok(ev, '缺少 stage_change 事件');
      assert.equal(ev.metadata.beep, true, '阶段切换未触发提示音');
      assert.ok(ev.metadata.phaseLabel, '阶段切换未带阶段名');
    },
  },
];
