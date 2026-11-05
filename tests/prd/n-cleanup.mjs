import assert from 'node:assert/strict';
import { read, render, contains, load, need, has } from './_helpers.mjs';

const area = 'cleanup';

export const checks = [
  {
    id: 'X1', area, title: '证据定位：按消息序号取回原话与上下文',
    async run() {
      const m = await load('engine/evidenceLocator.ts');
      need(m, 'locateEvidence');
      const messages = [
        { id: 'a', senderId: 'user', senderName: '我', content: '第一句', timestamp: 0, type: 'message', startMs: 0 },
        { id: 'b', senderId: 'c1', senderName: '林清', content: '第二句', timestamp: 1000, type: 'message', startMs: 1000 },
        { id: 'c', senderId: 'user', senderName: '我', content: '第三句', timestamp: 2000, type: 'message', startMs: 2000 },
      ];
      const r = m.locateEvidence(messages, { id: 'e', modality: 'text', timestamp_ms: 1000, content: '第二句', dimension_hint: 'content', message_index: 1 });
      assert.equal(r.message?.content, '第二句');
      assert.equal(r.context.length, 3);
      const miss = m.locateEvidence(messages, { id: 'e2', modality: 'text', timestamp_ms: 9000, content: 'x', dimension_hint: 'content', message_index: 99 });
      assert.equal(miss.message, null);
      assert.ok(miss.fallback.includes('未找到'));
    },
  },
  {
    id: 'X2', area, title: '报告页接线转写与定位弹层',
    async run() {
      const src = read('components/ReportView.tsx');
      assert.ok(/locateEvidence/.test(src), '报告页未用定位函数');
      assert.ok(/data-testid="evidence-locate"/.test(src), '缺少定位弹层');
      const app = read('App.tsx');
      assert.ok(/messages=\{finishedMessages\}/.test(app), 'App 未把转写传给报告页');
    },
  },
  {
    id: 'X3', area, title: '旧房间组件已删除（DiscussionPanel / VoiceRoom / AvatarStage / PayModal / classic）',
    async run() {
      for (const f of [
        'components/DiscussionPanel.tsx',
        'components/VoiceRoom.tsx',
        'components/AvatarStage.tsx',
        'components/PayModal.tsx',
        'components/classic/ClassicPhaseHeader.tsx',
      ]) {
        assert.equal(has(f), false, `${f} 应已删除`);
      }
    },
  },
  {
    id: 'X4', area, title: 'App 只有四个状态分支，无其他页面',
    async run() {
      const app = read('App.tsx');
      const branches = app.match(/\{state\.status === '(IDLE|PREPARING|DISCUSSING|FINISHED)' && \(/g) ?? [];
      assert.equal(branches.length, 4, `渲染分支数应为 4，实际 ${branches.length}`);
      assert.ok(!/react-router|useRoutes|createBrowserRouter/.test(app), '不应引入路由');
    },
  },
  {
    id: 'X5', area, title: '报告页仍保留链上铸证入口（懒加载 + 守卫）',
    async run() {
      const src = read('components/ReportView.tsx');
      assert.ok(/lazy\(\(\) => import\('\.\/CertificateSection'\)\)/.test(src));
      assert.ok(/isCertConfigured\(\)/.test(src));
    },
  },
];
