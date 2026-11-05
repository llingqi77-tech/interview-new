import assert from 'node:assert/strict';
import { read, render, contains, notContains, load, need } from './_helpers.mjs';

const area = 'wiring';

/**
 * 接线检查：组件存在 ≠ 应用在用。
 * 这一组断言「真实 App 渲染出来的就是 PRD 的界面」，防止只写组件不接线。
 */

export const checks = [
  {
    id: 'W1', area, title: 'App 首屏渲染的是新的练习配置（含 AI 生成题目 / 开始设备检测）',
    async run() {
      const App = await load('App.tsx');
      const html = render(App);
      contains(html, '目标公司', '应聘岗位', '无领导小组讨论', '结构化单面', 'AI 生成题目', '开始设备检测');
    },
  },
  {
    id: 'W2', area, title: 'App 接入 InterviewRoom（房间界面，经 RoomStage 容器）',
    async run() {
      const app = read('App.tsx');
      assert.ok(/<RoomStage/.test(app), 'App 未渲染房间容器 RoomStage');
      const stage = read('components/RoomStage.tsx');
      assert.ok(/from '\.\/InterviewRoom'/.test(stage), 'RoomStage 未引入 InterviewRoom');
      assert.ok(/<InterviewRoom/.test(stage), 'RoomStage 未渲染 InterviewRoom');
      assert.ok(/buildRoomView/.test(stage), 'RoomStage 未用 buildRoomView 派生视图');
    },
  },
  {
    id: 'W3', area, title: 'App 接入 ReportView（面后报告）',
    async run() {
      const app = read('App.tsx');
      assert.ok(/from '\.\/components\/ReportView'/.test(app), 'App 未引入 ReportView');
      assert.ok(/<ReportView/.test(app), 'App 未渲染 ReportView');
    },
  },
  {
    id: 'W4', area, title: 'App 不再渲染旧房间组件（DiscussionPanel / VoiceRoom / EvidenceReport）',
    async run() {
      const app = read('App.tsx');
      notContains(app, 'DiscussionPanel', 'VoiceRoom', 'EvidenceReport');
    },
  },
  {
    id: 'W5', area, title: '房间视图由纯函数 buildRoomView 从会话快照派生',
    async run() {
      const m = await load('engine/roomView.ts');
      need(m, 'buildRoomView');
      const view = m.buildRoomView({
        format: 'lgd',
        phaseState: { format: 'lgd', phaseIndex: 2, phaseStartedAt: 0, openingIndex: 0, openingStartedAt: 0, warned: false, wrapped: false, finished: false },
        now: 300000,
        topic: '题目',
        keyPoints: ['要点A'],
        messages: [],
        roles: [],
        interviewers: [],
        speakingCharId: null,
        thinking: false,
        streaming: false,
        inputMode: 'realtime',
        degraded: null,
        muted: false,
        cameraOn: true,
        textInputOpen: false,
      });
      assert.equal(view.phase.label, '自由讨论');
      assert.equal(view.phase.total, 4);
      assert.ok(view.phase.remainingMs > 0);
      assert.equal(view.speakingRight.kind, 'waiting');
      assert.equal(view.trajectory.total, 0);
    },
  },
  {
    id: 'W6', area, title: '阶段切换时由面试官播报固定引导语（controller 接线）',
    async run() {
      const c = read('src/session/sessionController.ts');
      assert.ok(/scriptFor|scriptToMessage/.test(c), 'controller 未使用引导语模块');
      assert.ok(/transitionKey/.test(c), 'controller 未按阶段切换取引导语 key');
    },
  },
  {
    id: 'W7', area, title: '阶段切换时播放倒计时提示音（controller 接线）',
    async run() {
      const c = read('src/session/sessionController.ts');
      assert.ok(/beepCuesFor|playBeep/.test(c), 'controller 未接线提示音');
    },
  },
  {
    id: 'W8', area, title: '真人说「我来总结」时改由真人总结（controller 接线）',
    async run() {
      const c = read('src/session/sessionController.ts');
      assert.ok(/detectSummaryIntent|resolveSummarizer/.test(c), 'controller 未接线总结意图识别');
    },
  },
];
