import assert from 'node:assert/strict';
import { render, contains, load, need } from './_helpers.mjs';

const area = 'report';

const dim = (score, evidence = []) => ({ score, max: 100, evidence, metrics: { 发言次数: 6 }, note: '规则引擎实算' });

const lgdReport = () => ({
  session_id: 1,
  format: 'lgd',
  overall_score: 82,
  band: '良好',
  dimensions: {
    content: dim(85, [{ id: 'e1', modality: 'text', timestamp_ms: 65000, content: '首先我建议按三个维度拆解', dimension_hint: 'content', message_index: 3 }]),
    teamwork: dim(80), structure: dim(78), leadership: dim(72), stress: dim(75),
    communication: dim(83), voice: dim(70), visual: dim(60),
  },
  suggestions: ['多用数据支撑观点', '主动邀请沉默成员发言'],
  created_at: '2026-11-05T00:00:00.000Z',
});

const panelReport = () => ({
  session_id: 2,
  format: 'panel',
  overall_score: 76,
  band: '合格',
  dimensions: {
    jobFit: dim(80), analysis: dim(75), star: dim(70), communication: dim(78), growth: dim(72),
    motivation: dim(74), resilience: dim(68), questions: dim(66), voiceVisual: dim(70),
  },
  suggestions: ['STAR 的 Result 要量化'],
  created_at: '2026-11-05T00:00:00.000Z',
});

export const checks = [
  {
    id: 'H1', area, title: '生成中提示「面试官正在整理评估报告…」',
    async run() {
      const m = await load('engine/reportCopy.ts');
      need(m, 'REPORT_LOADING_TEXT');
      assert.ok(m.REPORT_LOADING_TEXT.includes('面试官正在整理评估报告'));
    },
  },
  {
    id: 'H2', area, title: '报告生成目标 ≤20 秒',
    async run() {
      const m = await load('engine/reportCopy.ts');
      need(m, 'REPORT_TARGET_MS');
      assert.equal(m.REPORT_TARGET_MS, 20000);
    },
  },
  {
    id: 'H3', area, title: '生成失败可重试',
    async run() {
      const C = await load('components/ReportView.tsx');
      const html = render(C, { report: null, error: '网络异常', onRetry() {}, onRestart() {}, onDelete() {} });
      contains(html, '重试');
    },
  },
  {
    id: 'H4', area, title: '生成失败可返回主页',
    async run() {
      const C = await load('components/ReportView.tsx');
      const html = render(C, { report: null, error: '网络异常', onRetry() {}, onRestart() {}, onDelete() {} });
      contains(html, '返回主页');
    },
  },
  {
    id: 'H5', area, title: '综合得分环形图',
    async run() {
      const C = await load('components/ReportView.tsx');
      const html = render(C, { report: lgdReport(), onRestart() {}, onDelete() {}, onLocate() {} });
      assert.ok(/data-testid="score-ring"/.test(html), '缺少环形图');
      contains(html, '82');
    },
  },
  {
    id: 'H6', area, title: '分维度得分进度条',
    async run() {
      const C = await load('components/ReportView.tsx');
      const html = render(C, { report: lgdReport(), onRestart() {}, onDelete() {}, onLocate() {} });
      const bars = html.match(/data-testid="dimension-bar"/g) || [];
      assert.equal(bars.length, 8, `群面应有 8 条维度进度条，实际 ${bars.length}`);
      contains(html, '内容贡献', '团队协作', '结构贡献', '领导与影响力', '抗压与冲突处理', '沟通表达', '语音表现', '视觉表现');
    },
  },
  {
    id: 'H7', area, title: '指标标签',
    async run() {
      const C = await load('components/ReportView.tsx');
      const html = render(C, { report: lgdReport(), onRestart() {}, onDelete() {}, onLocate() {} });
      assert.ok(/data-testid="metric-tag"/.test(html), '缺少指标标签');
      contains(html, '发言次数');
    },
  },
  {
    id: 'H8', area, title: '证据引用带时间戳',
    async run() {
      const C = await load('components/ReportView.tsx');
      const html = render(C, { report: lgdReport(), onRestart() {}, onDelete() {}, onLocate() {} });
      contains(html, '01:05', '首先我建议按三个维度拆解');
    },
  },
  {
    id: 'H9', area, title: '点击证据可定位到对应发言',
    async run() {
      const C = await load('components/ReportView.tsx');
      const html = render(C, { report: lgdReport(), onRestart() {}, onDelete() {}, onLocate() {} });
      assert.ok(/data-message-index="3"/.test(html), '证据缺少定位锚点');
    },
  },
  {
    id: 'H10', area, title: '改进建议为编号列表',
    async run() {
      const C = await load('components/ReportView.tsx');
      const html = render(C, { report: lgdReport(), onRestart() {}, onDelete() {}, onLocate() {} });
      assert.ok(/<ol/.test(html), '建议不是有序列表');
      contains(html, '多用数据支撑观点');
    },
  },
  {
    id: 'H11', area, title: '可删除本次记录（不可恢复）',
    async run() {
      const C = await load('components/ReportView.tsx');
      const html = render(C, { report: lgdReport(), onRestart() {}, onDelete() {}, onLocate() {} });
      contains(html, '删除本次记录');
    },
  },
  {
    id: 'H12', area, title: '可再来一场',
    async run() {
      const C = await load('components/ReportView.tsx');
      const html = render(C, { report: lgdReport(), onRestart() {}, onDelete() {}, onLocate() {} });
      contains(html, '再来一场');
    },
  },
  {
    id: 'H13', area, title: '群面报告八维齐全',
    async run() {
      const m = await load('engine/reportEngine.ts');
      const r = m.buildReport({ format: 'lgd', transcripts: [], events: [], sessionStartAt: 0, durationMs: 600000 });
      assert.deepEqual(Object.keys(r.dimensions).sort(), ['communication', 'content', 'leadership', 'stress', 'structure', 'teamwork', 'visual', 'voice']);
    },
  },
  {
    id: 'H14', area, title: '单面报告九维齐全',
    async run() {
      const m = await load('engine/reportEngine.ts');
      const r = m.buildReport({ format: 'panel', transcripts: [], events: [], sessionStartAt: 0, durationMs: 600000 });
      assert.deepEqual(Object.keys(r.dimensions).sort(), ['analysis', 'communication', 'growth', 'jobFit', 'motivation', 'questions', 'resilience', 'star', 'voiceVisual']);
    },
  },
  {
    id: 'H15', area, title: '群面考察核心：协作、影响与贡献',
    async run() {
      const m = await load('engine/reportCopy.ts');
      need(m, 'CORE_FOCUS');
      assert.ok(m.CORE_FOCUS.lgd.includes('协作'), '群面考察核心缺少协作');
      assert.ok(m.CORE_FOCUS.lgd.includes('贡献'), '群面考察核心缺少贡献');
    },
  },
  {
    id: 'H16', area, title: '单面考察核心：个人素质与目标岗位匹配度',
    async run() {
      const m = await load('engine/reportCopy.ts');
      assert.ok(m.CORE_FOCUS.panel.includes('匹配'), '单面考察核心缺少匹配度');
    },
  },
  {
    id: 'H17', area, title: '未开启摄像头时视觉维度标记「本场未开启」',
    async run() {
      const m = await load('engine/reportEngine.ts');
      const r = m.buildReport({ format: 'lgd', transcripts: [], events: [], sessionStartAt: 0, durationMs: 600000, visualEnabled: false });
      assert.equal(r.dimensions.visual.status, 'not_enabled');
      const C = await load('components/ReportView.tsx');
      const html = render(C, { report: r, onRestart() {}, onDelete() {}, onLocate() {} });
      contains(html, '本场未开启');
    },
  },
];
