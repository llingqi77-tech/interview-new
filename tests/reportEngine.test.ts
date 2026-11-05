import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, computeRuleMetrics, collectEvidence, thresholdScore } from '../engine/reportEngine.ts';
import { LGD_WEIGHTS, PANEL_WEIGHTS, scoreBand } from '../engine/scoring.ts';
import type { Message } from '../types.ts';

const msg = (id: string, senderId: string, content: string, startMs: number, endMs: number): Message => ({
  id,
  senderId,
  senderName: senderId === 'user' ? '我' : senderId,
  content,
  timestamp: startMs,
  type: 'message',
  startMs,
  endMs,
});

const transcripts: Message[] = [
  msg('m1', 'user', '首先我建议按成本、时效、风险三个维度拆解，其次给出结论', 0, 6000),
  msg('m2', 'c1', '我同意你的框架，补充一点风险', 7000, 11000),
  msg('m3', 'user', '我同意林清的风险判断，也支持成本优先，另外我提议我们统一按成本优先', 12000, 18000),
  msg('m4', 'c2', '那我来总结一下', 19000, 21000),
];

test('规则引擎实算：话语权占比 / 发言频次 / 结构标记 / 回应次数', () => {
  const m = computeRuleMetrics(transcripts, [], 0);
  assert.equal(m.userMessageCount, 2);
  assert.equal(m.totalMessageCount, 4);
  assert.ok(m.voiceShareByTime > 0 && m.voiceShareByTime <= 100);
  assert.ok(m.structureMarkerCount >= 2);
  assert.ok(m.responseCount >= 2);
});

test('群面报告：八维齐全且总分在 0-100', () => {
  const r = buildReport({ format: 'lgd', transcripts, events: [], sessionStartAt: 0, durationMs: 600000 });
  assert.deepEqual(Object.keys(r.dimensions).sort(), [
    'communication', 'content', 'leadership', 'stress', 'structure', 'teamwork', 'visual', 'voice',
  ]);
  assert.ok(r.overall_score >= 0 && r.overall_score <= 100);
  assert.equal(r.band, scoreBand(r.overall_score).label);
  assert.equal(Object.values(r.weights).reduce((a, b) => a + b, 0), 100);
});

test('单面报告：九维齐全', () => {
  const r = buildReport({ format: 'panel', transcripts, events: [], sessionStartAt: 0, durationMs: 600000 });
  assert.deepEqual(Object.keys(r.dimensions).sort(), [
    'analysis', 'communication', 'growth', 'jobFit', 'motivation', 'questions', 'resilience', 'star', 'voiceVisual',
  ]);
});

test('纯语音模式：视觉维度 not_enabled 且权重按比例分摊', () => {
  const r = buildReport({ format: 'lgd', transcripts, events: [], sessionStartAt: 0, durationMs: 600000, visualEnabled: false });
  assert.equal(r.dimensions.visual.status, 'not_enabled');
  assert.equal(r.weights.visual, 0);
  assert.equal(Object.values(r.weights).reduce((a, b) => a + b, 0), 100);
  const p = buildReport({ format: 'panel', transcripts, events: [], sessionStartAt: 0, durationMs: 600000, visualEnabled: false });
  assert.equal(p.dimensions.voiceVisual.status, 'not_enabled');
  assert.equal(p.weights.voiceVisual, 0);
});

test('视觉开启时按标准权重计入', () => {
  const r = buildReport({
    format: 'lgd',
    transcripts,
    events: [],
    sessionStartAt: 0,
    durationMs: 600000,
    visualEnabled: true,
    visualStats: {
      validRows: 60,
      eyeContactRatio: 0.8,
      nervousRatio: 0.1,
      headDownRatio: 0.1,
      headTurnRatio: 0.1,
      headPoseRatio: 0.2,
      engagementRatio: 0.9,
      rawScore: 80,
      evidence: [],
    },
  });
  assert.equal(r.dimensions.visual.status, 'enabled');
  assert.deepEqual({ ...r.weights }, { ...LGD_WEIGHTS });
});

test('AI 语义分参与融合打分', () => {
  const base = buildReport({ format: 'lgd', transcripts, events: [], sessionStartAt: 0, durationMs: 600000 });
  const boosted = buildReport({
    format: 'lgd',
    transcripts,
    events: [],
    sessionStartAt: 0,
    durationMs: 600000,
    semantic: { content: 100, teamwork: 100, structure: 100, leadership: 100, stress: 100, communication: 100 },
  });
  assert.ok(boosted.dimensions.content.score > base.dimensions.content.score);
  assert.ok(boosted.overall_score > base.overall_score);
});

test('证据池：带时间戳与消息序号，可定位', () => {
  const r = buildReport({ format: 'lgd', transcripts, events: [], sessionStartAt: 0, durationMs: 600000 });
  const evidence = collectEvidence(r);
  assert.ok(evidence.length > 0);
  for (const ev of evidence) {
    assert.equal(typeof ev.timestamp_ms, 'number');
    assert.equal(typeof ev.message_index, 'number');
  }
});

test('改进建议：编号列表，最多 4 条', () => {
  const r = buildReport({ format: 'lgd', transcripts, events: [], sessionStartAt: 0, durationMs: 600000 });
  assert.ok(r.suggestions.length > 0 && r.suggestions.length <= 4);
});

test('真人主动争取总结 → 总分加分', () => {
  const base = buildReport({ format: 'lgd', transcripts, events: [], sessionStartAt: 0, durationMs: 600000 });
  const bonus = buildReport({ format: 'lgd', transcripts, events: [], sessionStartAt: 0, durationMs: 600000, summaryByUser: true });
  assert.ok(bonus.overall_score >= base.overall_score);
});

test('空转写不崩溃', () => {
  const r = buildReport({ format: 'panel', transcripts: [], events: [], sessionStartAt: 0, durationMs: 600000 });
  assert.ok(r.overall_score >= 0);
  assert.equal(Object.keys(r.dimensions).length, 9);
});

test('阈值映射', () => {
  assert.equal(thresholdScore(5, 5, 0), 100);
  assert.equal(thresholdScore(0, 5, 0), 0);
  assert.equal(thresholdScore(2.5, 5, 0), 50);
});

test('单面权重与群面权重各自合计 100', () => {
  assert.equal(Object.values(LGD_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.equal(Object.values(PANEL_WEIGHTS).reduce((a, b) => a + b, 0), 100);
});
