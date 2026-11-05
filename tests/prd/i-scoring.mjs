import assert from 'node:assert/strict';
import { load, need, near } from './_helpers.mjs';

const area = 'scoring';

const LGD_EXPECT = { content: 20, teamwork: 20, structure: 15, leadership: 15, stress: 10, communication: 10, voice: 8, visual: 2 };
const PANEL_EXPECT = { jobFit: 25, analysis: 15, star: 15, communication: 10, growth: 10, motivation: 10, resilience: 10, questions: 3, voiceVisual: 2 };

export const checks = [
  {
    id: 'I1', area, title: '百分制',
    async run() {
      const m = await load('engine/scoring.ts');
      need(m, 'computeOverall');
      const s = m.computeOverall({ content: 100, teamwork: 100, structure: 100, leadership: 100, stress: 100, communication: 100, voice: 100, visual: 100 }, m.LGD_WEIGHTS);
      assert.equal(s, 100);
      const z = m.computeOverall({ content: 0, teamwork: 0, structure: 0, leadership: 0, stress: 0, communication: 0, voice: 0, visual: 0 }, m.LGD_WEIGHTS);
      assert.equal(z, 0);
    },
  },
  {
    id: 'I2', area, title: '总分 = Σ 维度得分 × 权重',
    async run() {
      const m = await load('engine/scoring.ts');
      const scores = { content: 80, teamwork: 60, structure: 70, leadership: 50, stress: 90, communication: 75, voice: 65, visual: 40 };
      const expected = Object.entries(LGD_EXPECT).reduce((acc, [k, w]) => acc + scores[k] * (w / 100), 0);
      near(m.computeOverall(scores, m.LGD_WEIGHTS), Math.round(expected), 0.51, '加权总分');
    },
  },
  {
    id: 'I3', area, title: '群面权重合计 100%',
    async run() {
      const m = await load('engine/scoring.ts');
      const sum = Object.values(m.LGD_WEIGHTS).reduce((a, b) => a + b, 0);
      assert.equal(sum, 100);
    },
  },
  {
    id: 'I4', area, title: '单面权重合计 100%',
    async run() {
      const m = await load('engine/scoring.ts');
      const sum = Object.values(m.PANEL_WEIGHTS).reduce((a, b) => a + b, 0);
      assert.equal(sum, 100);
    },
  },
  {
    id: 'I5', area, title: '群面八维权重：内容20/协作20/结构15/领导15/抗压10/沟通10/语音8/视觉2',
    async run() {
      const m = await load('engine/scoring.ts');
      assert.deepEqual({ ...m.LGD_WEIGHTS }, LGD_EXPECT);
    },
  },
  {
    id: 'I6', area, title: '单面九维权重：匹配25/分析15/STAR15/沟通10/成长10/动机10/抗压10/反问3/语音视觉2',
    async run() {
      const m = await load('engine/scoring.ts');
      assert.deepEqual({ ...m.PANEL_WEIGHTS }, PANEL_EXPECT);
    },
  },
  {
    id: 'I7', area, title: '分数段解读：≥90 优秀 / 80-89 良好 / 70-79 合格 / 60-69 待提升 / <60 重点改进',
    async run() {
      const m = await load('engine/scoring.ts');
      need(m, 'scoreBand');
      assert.equal(m.scoreBand(95).label, '优秀');
      assert.equal(m.scoreBand(90).label, '优秀');
      assert.equal(m.scoreBand(89).label, '良好');
      assert.equal(m.scoreBand(80).label, '良好');
      assert.equal(m.scoreBand(79).label, '合格');
      assert.equal(m.scoreBand(70).label, '合格');
      assert.equal(m.scoreBand(69).label, '待提升');
      assert.equal(m.scoreBand(60).label, '待提升');
      assert.equal(m.scoreBand(59).label, '重点改进');
      assert.equal(m.scoreBand(0).label, '重点改进');
    },
  },
  {
    id: 'I8', area, title: '纯语音模式不评估视觉，权重按比例分摊至其余维度',
    async run() {
      const m = await load('engine/scoring.ts');
      need(m, 'redistribute');
      const r = m.redistribute(m.LGD_WEIGHTS, ['visual']);
      assert.equal(r.visual, 0);
      assert.equal(Object.values(r).reduce((a, b) => a + b, 0), 100);
      near(r.content, 20 / 0.98, 0.02, '内容权重按比例放大');
      const p = m.redistribute(m.PANEL_WEIGHTS, ['voiceVisual']);
      assert.equal(p.voiceVisual, 0);
      assert.equal(Object.values(p).reduce((a, b) => a + b, 0), 100);
    },
  },
  {
    id: 'I9', area, title: '权重支持按岗位类型与职级配置',
    async run() {
      const m = await load('engine/scoring.ts');
      need(m, 'weightsFor');
      const custom = m.weightsFor('panel', { jobFamily: 'tech', level: 'senior' });
      assert.equal(Object.values(custom).reduce((a, b) => a + b, 0), 100);
      const boosted = m.weightsFor('panel', { jobFamily: 'tech', level: 'senior', overrides: { jobFit: 30 } });
      assert.equal(boosted.jobFit, 30);
      assert.equal(Object.values(boosted).reduce((a, b) => a + b, 0), 100);
    },
  },
  {
    id: 'I10', area, title: '无配置时按标准权重计算',
    async run() {
      const m = await load('engine/scoring.ts');
      assert.deepEqual({ ...m.weightsFor('lgd') }, LGD_EXPECT);
      assert.deepEqual({ ...m.weightsFor('panel') }, PANEL_EXPECT);
    },
  },
  {
    id: 'I11', area, title: '每个维度子分 0-100',
    async run() {
      const m = await load('engine/scoring.ts');
      need(m, 'clampScore');
      assert.equal(m.clampScore(-5), 0);
      assert.equal(m.clampScore(105), 100);
      assert.equal(m.clampScore(73.4), 73);
    },
  },
  {
    id: 'I12', area, title: '规则引擎实算指标 + AI 语义分析共同打分',
    async run() {
      const m = await load('engine/reportEngine.ts');
      need(m, 'buildReport');
      const r = m.buildReport({
        format: 'lgd',
        transcripts: [
          { id: 'm1', senderId: 'user', senderName: '我', content: '首先我建议按成本、时效、风险三个维度拆解，其次给出结论', timestamp: 1000, type: 'message', startMs: 0, endMs: 6000 },
          { id: 'm2', senderId: 'c1', senderName: '林清', content: '我同意你的框架，补充一点风险', timestamp: 8000, type: 'message', startMs: 7000, endMs: 11000 },
        ],
        events: [],
        sessionStartAt: 0,
        durationMs: 600000,
        semantic: { content: 82, structure: 78, teamwork: 80, leadership: 70, stress: 75, communication: 80 },
      });
      assert.ok(r.dimensions.content.metrics && Object.keys(r.dimensions.content.metrics).length > 0, '缺少规则引擎实算指标');
      assert.ok(r.dimensions.content.note || r.dimensions.content.evidence.length > 0, '缺少语义分析痕迹');
      assert.ok(r.overall_score >= 0 && r.overall_score <= 100);
    },
  },
];
