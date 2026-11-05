import assert from 'node:assert/strict';
import { load, need } from './_helpers.mjs';

const area = 'panel';

export const checks = [
  {
    id: 'G1', area, title: '自我介绍 1 分钟',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      const d = p.getPhaseDefs('panel').find((x) => x.id === 'SELF_INTRO');
      assert.equal(d.durationMs, 60000);
    },
  },
  {
    id: 'G2', area, title: '自我介绍弹窗提示：一分钟介绍学历、专业背景和过往经历',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      need(p, 'PANEL_INTRO_PROMPT');
      assert.ok(p.PANEL_INTRO_PROMPT.includes('一分钟'), '缺少时长提示');
      assert.ok(p.PANEL_INTRO_PROMPT.includes('学历'), '缺少学历提示');
      assert.ok(p.PANEL_INTRO_PROMPT.includes('专业背景'), '缺少专业背景提示');
      assert.ok(p.PANEL_INTRO_PROMPT.includes('过往经历'), '缺少过往经历提示');
    },
  },
  {
    id: 'G3', area, title: '面试官问答 8-10 分钟',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      const d = p.getPhaseDefs('panel').find((x) => x.id === 'QA');
      assert.ok(d.durationMs >= 480000 && d.durationMs <= 600000, `问答时长越界: ${d.durationMs}`);
      assert.equal(p.PANEL_QA_MIN_MS, 480000);
      assert.equal(p.PANEL_QA_MAX_MS, 600000);
    },
  },
  {
    id: 'G4', area, title: '主面试官负责专业知识与过往经历的结构化面试',
    async run() {
      const m = await load('data/interviewers.ts');
      need(m, 'PANEL_DUTIES');
      assert.ok(m.PANEL_DUTIES.lead.includes('专业知识'), '主面试官职责缺少专业知识');
      assert.ok(m.PANEL_DUTIES.lead.includes('过往经历'), '主面试官职责缺少过往经历');
    },
  },
  {
    id: 'G5', area, title: '副面试官负责职业意愿匹配与职业规划',
    async run() {
      const m = await load('data/interviewers.ts');
      assert.ok(m.PANEL_DUTIES.support.includes('职业意愿'), '副面试官职责缺少职业意愿');
      assert.ok(m.PANEL_DUTIES.support.includes('职业规划'), '副面试官职责缺少职业规划');
    },
  },
  {
    id: 'G6', area, title: '两位面试官轮流提问与追问',
    async run() {
      const m = await load('engine/panelTurn.ts');
      need(m, 'createPanelTurn');
      const t = m.createPanelTurn(['lead', 'support']);
      const seq = [t.next(), t.next(), t.next(), t.next()];
      assert.deepEqual(seq, ['lead', 'support', 'lead', 'support']);
      assert.equal(t.canFollowUp(), true, '应支持追问');
    },
  },
  {
    id: 'G7', area, title: '反问面试官 2 分钟',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      const d = p.getPhaseDefs('panel').find((x) => x.id === 'COUNTER_ASK');
      assert.equal(d.durationMs, 120000);
    },
  },
  {
    id: 'G8', area, title: '反问允许 2-3 个问题',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      need(p, 'COUNTER_ASK_RANGE');
      assert.deepEqual([...p.COUNTER_ASK_RANGE], [2, 3]);
    },
  },
  {
    id: 'G9', area, title: '结构化单面只有一位候选人（真人）',
    async run() {
      const m = await load('engine/roster.ts');
      need(m, 'panelRoster');
      const r = m.panelRoster({ company: '字节跳动', jobTitle: '产品经理', interviewerIds: ['visionary', 'product_legend'] });
      assert.equal(r.candidates.length, 0);
      assert.equal(r.interviewers.length, 2);
      assert.equal(r.totalCandidates, 1);
    },
  },
  {
    id: 'G10', area, title: '反问结束生成面后报告',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      const cfg = { durationsMs: { COUNTER_ASK: 1000 } };
      const s0 = { ...p.initPhaseEngine(0, 'panel', cfg), phaseIndex: 2, phaseStartedAt: 0 };
      const r = p.tickPhase(s0, 1500, 'panel', cfg, 0);
      assert.equal(r.state.finished, true);
    },
  },
];
