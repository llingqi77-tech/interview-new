import assert from 'node:assert/strict';
import { load, need, read } from './_helpers.mjs';

const area = 'lgd';

export const checks = [
  {
    id: 'L1', area, title: '组成：1 位主持面试官 + 3 位 AI 候选人 + 真人',
    async run() {
      const m = await load('engine/roster.ts');
      need(m, 'lgdRoster');
      const r = m.lgdRoster({ company: '字节跳动', jobTitle: '产品经理', seed: 3 });
      assert.equal(r.host.role, 'host');
      assert.equal(r.candidates.length, 3);
      assert.equal(r.totalCandidates, 4);
    },
  },
  {
    id: 'L2', area, title: '主持面试官不发表业务观点，只控场',
    async run() {
      const m = await load('api/_lib/prompts.ts');
      need(m, 'HOST_SYSTEM_PROMPT');
      assert.ok(m.HOST_SYSTEM_PROMPT.includes('不发表业务观点'), '主持 prompt 未约束业务观点');
      for (const k of ['开场', '环节切换', '提醒时间', '邀请沉默者', '引导总结']) {
        assert.ok(m.HOST_SYSTEM_PROMPT.includes(k), `主持职责缺少 ${k}`);
      }
    },
  },
  {
    id: 'L3', area, title: '审题阶段 3 分钟',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      const defs = p.getPhaseDefs('lgd');
      const reading = defs.find((d) => d.id === 'READING');
      assert.equal(reading.durationMs, 180000);
      assert.equal(reading.allowSpeech, false);
    },
  },
  {
    id: 'L4', area, title: '自我介绍每人 1 分钟，共 4 分钟',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      const defs = p.getPhaseDefs('lgd');
      const intro = defs.find((d) => d.id === 'INTRO');
      assert.equal(intro.durationMs, 240000);
      assert.equal(p.INTRO_TURN_MS, 60000);
    },
  },
  {
    id: 'L5', area, title: '可一键跳过所有 AI 候选人的自我介绍',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      need(p, 'skipAiIntro');
      const cfg = { openingOrder: ['user', 'c1', 'c2', 'c3'] };
      const s0 = p.initPhaseEngine(0, 'lgd', cfg);
      const atIntro = { ...s0, phaseIndex: 1, phaseStartedAt: 0, openingIndex: 1, openingStartedAt: 0 };
      const r = p.skipAiIntro(atIntro, 30000, 'lgd', cfg, 0);
      assert.equal(r.state.phaseIndex, 2, '未跳到自由讨论');
      assert.ok(r.events.some((e) => e.event_type === 'stage_change'));
    },
  },
  {
    id: 'L6', area, title: '默认真人先做自我介绍',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      const order = p.defaultOpeningOrder(['c1', 'c2', 'c3']);
      assert.equal(order[0], 'user');
      assert.equal(order.length, 4);
    },
  },
  {
    id: 'L7', area, title: '自由讨论 15 分钟',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      const free = p.getPhaseDefs('lgd').find((d) => d.id === 'FREE_DISCUSSION');
      assert.equal(free.durationMs, 900000);
    },
  },
  {
    id: 'L8', area, title: '调度权随机分配给 3 位 AI，次数尽量平均',
    async run() {
      const m = await load('engine/scheduler.ts');
      need(m, 'createScheduler');
      const s = m.createScheduler(['c1', 'c2', 'c3'], 42);
      const counts = { c1: 0, c2: 0, c3: 0 };
      for (let i = 0; i < 30; i++) counts[s.next()] += 1;
      const vals = Object.values(counts);
      assert.ok(Math.max(...vals) - Math.min(...vals) <= 1, `分配不均: ${JSON.stringify(counts)}`);
      const s2 = m.createScheduler(['c1', 'c2', 'c3'], 42);
      const s3 = m.createScheduler(['c1', 'c2', 'c3'], 99);
      const seq2 = Array.from({ length: 6 }, () => s2.next()).join(',');
      const seq3 = Array.from({ length: 6 }, () => s3.next()).join(',');
      assert.notEqual(seq2, seq3, '不同种子应产生不同顺序');
    },
  },
  {
    id: 'L9', area, title: '真人点击麦克风即可抢话',
    async run() {
      const m = await load('engine/scheduler.ts');
      need(m, 'requestFloor');
      const r = m.requestFloor({ speakingId: 'c1', phase: 'FREE_DISCUSSION' });
      assert.equal(r.granted, true);
      assert.equal(r.interrupted, 'c1');
    },
  },
  {
    id: 'L10', area, title: 'AI 不打断真人',
    async run() {
      const m = await load('engine/scheduler.ts');
      need(m, 'canAiInterrupt');
      assert.equal(m.canAiInterrupt('user'), false);
      assert.equal(m.canAiInterrupt('c1'), true);
    },
  },
  {
    id: 'L11', area, title: 'AI 需对真人观点表达同意/反对/质疑',
    async run() {
      const m = await load('api/_lib/prompts.ts');
      need(m, 'CANDIDATE_SYSTEM_PROMPT');
      for (const k of ['同意', '反对', '质疑']) {
        assert.ok(m.CANDIDATE_SYSTEM_PROMPT.includes(k), `候选人 prompt 缺少 ${k}`);
      }
    },
  },
  {
    id: 'L12', area, title: '自由讨论最后 3 分钟进入收尾提示',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      need(p, 'FREE_WRAP_MS');
      assert.equal(p.FREE_WRAP_MS, 180000);
      const cfg = { durationsMs: { FREE_DISCUSSION: 900000 } };
      const s0 = { ...p.initPhaseEngine(0, 'lgd', cfg), phaseIndex: 2, phaseStartedAt: 0 };
      const r = p.tickPhase(s0, 900000 - 180000, 'lgd', cfg, 0);
      assert.ok(r.events.some((e) => e.event_type === 'wrap_up'), '未触发收尾提示');
    },
  },
  {
    id: 'L13', area, title: '自由讨论分四段：开场时间分配 / 按要点深入 / 争执达成一致 / 收尾铺垫',
    async run() {
      const m = await load('engine/discussionPlan.ts');
      need(m, 'FREE_SUBSTAGES');
      assert.equal(m.FREE_SUBSTAGES.length, 4);
      const ids = m.FREE_SUBSTAGES.map((s) => s.id);
      assert.deepEqual(ids, ['open', 'deepen', 'converge', 'wrap']);
      assert.ok(m.FREE_SUBSTAGES[1].instruction.includes('要点'), '深入讨论未要求覆盖题目要点');
      assert.ok(m.FREE_SUBSTAGES[2].instruction.includes('一致'), '争执段未要求达成一致');
    },
  },
  {
    id: 'L14', area, title: '总结陈词 3 分钟',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      const sum = p.getPhaseDefs('lgd').find((d) => d.id === 'SUMMARY');
      assert.equal(sum.durationMs, 180000);
    },
  },
  {
    id: 'L15', area, title: '自由讨论最后阶段由调度器分配某个角色总结',
    async run() {
      const m = await load('engine/summaryIntent.ts');
      need(m, 'assignSummarizer');
      const who = m.assignSummarizer({ candidates: ['c1', 'c2', 'c3'], seed: 5 });
      assert.ok(['c1', 'c2', 'c3'].includes(who));
    },
  },
  {
    id: 'L16', area, title: '真人说「我来总结」则改由真人总结',
    async run() {
      const m = await load('engine/summaryIntent.ts');
      need(m, 'detectSummaryIntent', 'resolveSummarizer');
      assert.equal(m.detectSummaryIntent('我来总结'), true);
      assert.equal(m.detectSummaryIntent('那我来做总结吧'), true);
      assert.equal(m.detectSummaryIntent('我觉得成本更重要'), false);
      const r = m.resolveSummarizer({ candidates: ['c1', 'c2', 'c3'], seed: 5, userText: '我来总结' });
      assert.equal(r.speakerId, 'user');
      assert.equal(r.byUser, true);
    },
  },
  {
    id: 'L17', area, title: '自由讨论阶段引导用户主动提出总结（可提高分数）',
    async run() {
      const m = await load('api/_lib/prompts.ts');
      assert.ok(m.HOST_SYSTEM_PROMPT.includes('我来总结'), '主持 prompt 未引导用户主动总结');
      const s = await load('engine/summaryIntent.ts');
      assert.ok(s.SUMMARY_BONUS > 0, '主动总结未设置加分');
    },
  },
  {
    id: 'L18', area, title: '总结陈词结束自动进入面后报告',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      const cfg = { durationsMs: { SUMMARY: 1000 } };
      const s0 = { ...p.initPhaseEngine(0, 'lgd', cfg), phaseIndex: 3, phaseStartedAt: 0 };
      const r = p.tickPhase(s0, 1500, 'lgd', cfg, 0);
      assert.equal(r.state.finished, true);
      assert.ok(r.events.some((e) => e.event_type === 'stage_change' && e.target === 'FINISHED'));
    },
  },
];
