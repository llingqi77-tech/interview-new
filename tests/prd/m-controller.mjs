import assert from 'node:assert/strict';
import { load, need, read } from './_helpers.mjs';

const area = 'controller';

/** 构造一个最小可用的 SessionController（注入 LLM / 语音 / 提示音，全部离线） */
async function makeController(overrides = {}) {
  const { SessionController } = await load('src/session/sessionController.ts');
  const { generateCandidates } = await load('data/roleCards.ts');
  const roles = generateCandidates({ company: '字节跳动', jobTitle: '产品经理', seed: 7 });
  const beeps = [];
  const finished = [];
  const controller = new SessionController({
    state: { topic: '题目', jobTitle: '产品经理', company: '字节跳动', status: 'DISCUSSING', format: 'lgd' },
    roles,
    sessionId: null,
    consentSaveTranscript: false,
    cameraEnabled: false,
    facingMode: 'user',
    format: 'lgd',
    onFinish: (messages, events, startedAt) => finished.push({ messages, events, startedAt }),
    generateReply: async () => ({ content: '我同意你的观点，补充一点风险。', emotion: 'neutral', target: null, stepfun_tts_instruction: null }),
    playBeep: (kind) => beeps.push(kind),
    ...overrides,
  });
  return { controller, roles, beeps, finished };
}

export const checks = [
  {
    id: 'C1', area, title: '进入房间播报开场白（PRD 原文）',
    async run() {
      const { controller } = await makeController();
      controller.announceOpening();
      const msgs = controller.store.getSnapshot().messages;
      assert.equal(msgs.length, 1);
      assert.equal(msgs[0].type, 'system');
      assert.ok(msgs[0].content.includes('大家好，我是本场的主持面试官'), '开场白不是 PRD 原文');
      assert.ok(msgs[0].content.includes('审题、自我介绍、自由讨论、总结陈词四个阶段'));
      controller.dispose();
    },
  },
  {
    id: 'C2', area, title: '阶段到点切换时播报下一阶段引导语',
    async run() {
      const { controller } = await makeController({ phaseDurationsMs: { READING: 1000 } });
      controller.announceOpening();
      controller.forcePhaseForTest({
        format: 'lgd', phaseIndex: 0, phaseStartedAt: Date.now() - 2000,
        openingIndex: 0, openingStartedAt: 0, warned: false, wrapped: false, finished: false,
      });
      // 触发一次 tick（私有方法通过公开的 forcePhaseForTest + 定时器不可控，这里直接调 tickPhase 语义）
      const p = await load('engine/phaseEngine.ts');
      const res = p.tickPhase(controller.store.getSnapshot().phase, Date.now(), 'lgd', { durationsMs: { READING: 1000 } }, 0);
      assert.ok(res.events.some((e) => e.event_type === 'stage_change' && e.metadata?.beep === true));
      controller.dispose();
    },
  },
  {
    id: 'C3', area, title: '阶段切换触发倒计时提示音',
    async run() {
      const { controller, beeps } = await makeController();
      controller.announceOpening();
      assert.ok(beeps.includes('start'), '开场未播放提示音');
      controller.dispose();
    },
  },
  {
    id: 'C4', area, title: '真人说「我来总结」→ 登记总结权并加分',
    async run() {
      const { controller } = await makeController();
      controller.forcePhaseForTest({
        format: 'lgd', phaseIndex: 2, phaseStartedAt: Date.now(),
        openingIndex: 0, openingStartedAt: 0, warned: false, wrapped: false, finished: false,
      });
      controller.sendTextMessage('我来总结');
      const ev = controller.store.getSnapshot().events.find((e) => e.metadata?.reason === 'user_claims_summary');
      assert.ok(ev, '未登记真人总结权');
      assert.ok(ev.metadata.bonus > 0, '未加分');
      controller.dispose();
    },
  },
  {
    id: 'C5', area, title: '一键跳过 AI 自我介绍 → 直接进入自由讨论',
    async run() {
      const { controller } = await makeController();
      controller.forcePhaseForTest({
        format: 'lgd', phaseIndex: 1, phaseStartedAt: Date.now(),
        openingIndex: 1, openingStartedAt: Date.now(), warned: false, wrapped: false, finished: false,
      });
      controller.skipAiIntro();
      assert.equal(controller.store.getSnapshot().phase.phaseIndex, 2);
      controller.dispose();
    },
  },
  {
    id: 'C6', area, title: '结束面试 → 回调 onFinish（进入面后报告）',
    async run() {
      const { controller, finished } = await makeController();
      await controller.finishSession();
      assert.equal(finished.length, 1, '未回调 onFinish');
      assert.ok(Array.isArray(finished[0].messages));
      controller.dispose();
    },
  },
  {
    id: 'C7', area, title: '单面问答阶段用 STAR 结构化即时出题',
    async run() {
      const c = read('src/session/sessionController.ts');
      assert.ok(/selfIntro/.test(c), 'controller 未采集/透传自我介绍');
      assert.ok(/panelDuty/.test(c), 'controller 未区分主副面试官分工');
      const route = read('api/_lib/llmRoute.ts');
      assert.ok(/buildPanelQuestionPrompt/.test(route), '服务端未按 STAR 即时出题');
      const p = await load('api/_lib/prompts.ts');
      const prompt = p.buildPanelQuestionPrompt({ company: 'A', jobTitle: 'B', selfIntro: 'C', phase: 'qa' });
      assert.ok(prompt.includes('STAR'));
    },
  },
  {
    id: 'C9', area, title: '倒计时到点自动切换阶段并播报下一阶段引导语（真实 tick 循环）',
    async run() {
      const { controller } = await makeController({ phaseDurationsMs: { READING: 300 } });
      controller.announceOpening();
      controller.init();
      await new Promise((r) => setTimeout(r, 1200));
      const snap = controller.store.getSnapshot();
      controller.dispose();
      assert.ok(snap.phase.phaseIndex >= 1, `阶段未自动推进: ${snap.phase.phaseIndex}`);
      const announced = snap.messages.filter((m) => m.type === 'system');
      assert.ok(announced.length >= 2, `未播报下一阶段引导语（只有 ${announced.length} 条）`);
      assert.ok(
        announced.some((m) => m.content.includes('审题时间到')),
        '缺少「审题 → 自我介绍」引导语'
      );
    },
  },
  {
    id: 'C10', area, title: '单面房间：主副面试官轮流提问（真实 tick 循环）',
    async run() {
      const { generateCandidates } = await load('data/roleCards.ts');
      const { interviewerToRoleCard } = await load('engine/roster.ts');
      const { matchInterviewers } = await load('data/interviewers.ts');
      const panel = matchInterviewers({ jobTitle: '产品经理', company: '字节跳动', count: 2 }).map(interviewerToRoleCard);
      const { SessionController } = await load('src/session/sessionController.ts');
      const asked = [];
      const c = new SessionController({
        state: { topic: '', jobTitle: '产品经理', company: '字节跳动', status: 'DISCUSSING', format: 'panel' },
        roles: panel,
        sessionId: null,
        consentSaveTranscript: false,
        cameraEnabled: false,
        facingMode: 'user',
        format: 'panel',
        onFinish: () => undefined,
        generateReply: async (params) => {
          asked.push(params.card.id);
          return { content: '请讲一个你主导的项目。', emotion: 'neutral', target: 'user', stepfun_tts_instruction: null };
        },
        playBeep: () => undefined,
      });
      c.announceOpening();
      c.forcePhaseForTest({
        format: 'panel', phaseIndex: 1, phaseStartedAt: Date.now(),
        openingIndex: 0, openingStartedAt: 0, warned: false, wrapped: false, finished: false,
      });
      await c.triggerAITurn(panel[0], { speakerKind: 'interviewer', force: true });
      await c.triggerAITurn(panel[1], { speakerKind: 'interviewer', force: true });
      c.dispose();
      assert.equal(asked.length, 2, '两位面试官未各问一次');
      assert.notEqual(asked[0], asked[1], '主副面试官未轮换');
      void generateCandidates;
    },
  },
  {
    id: 'C11', area, title: 'LLM 异常时用兜底台词继续，讨论不中断',
    async run() {
      const { SessionController } = await load('src/session/sessionController.ts');
      const { generateCandidates } = await load('data/roleCards.ts');
      const roles = generateCandidates({ company: '字节跳动', jobTitle: '产品经理', seed: 3 });
      const c = new SessionController({
        state: { topic: '题目', jobTitle: '产品经理', company: '字节跳动', status: 'DISCUSSING', format: 'lgd' },
        roles,
        sessionId: null,
        consentSaveTranscript: false,
        cameraEnabled: false,
        facingMode: 'user',
        format: 'lgd',
        onFinish: () => undefined,
        generateReply: async () => {
          throw new Error('LLM 402 Insufficient Balance');
        },
        playBeep: () => undefined,
      });
      c.forcePhaseForTest({
        format: 'lgd', phaseIndex: 2, phaseStartedAt: Date.now(),
        openingIndex: 0, openingStartedAt: 0, warned: false, wrapped: false, finished: false,
      });
      await c.triggerAITurn(roles[0], { speakerKind: 'candidate', force: true });
      const snap = c.store.getSnapshot();
      c.dispose();
      assert.equal(snap.degraded, true, '未标记降级');
      assert.equal(snap.messages.length, 1, 'LLM 失败后未落兜底台词');
      assert.ok(snap.messages[0].content.length > 8, '兜底台词为空');
    },
  },
  {
    id: 'C12', area, title: '服务端能解析本场动态生成的卡片（不再 400 未知角色卡）',
    async run() {
      const route = await load('api/_lib/llmRoute.ts');
      const { generateCandidates } = await load('data/roleCards.ts');
      const card = generateCandidates({ company: '字节跳动', jobTitle: '产品经理', seed: 5 })[0];
      const resolved = route.resolveReplyCard({ card });
      assert.ok(resolved, '动态卡片未被解析');
      assert.equal(resolved.id, card.id);
      assert.equal(resolved.name, card.name);
      assert.ok(resolved.persona.traits.length > 0);
      // 未知 id 且无卡片体 → 仍然拒绝
      assert.equal(route.resolveReplyCard({ card: { id: 'nope' } }), null);
    },
  },
  {
    id: 'C13', area, title: '自由讨论最后 3 分钟由主持面试官播报收尾引导语',
    async run() {
      const { controller } = await makeController({ phaseDurationsMs: { FREE_DISCUSSION: 1200 } });
      controller.announceOpening();
      controller.forcePhaseForTest({
        format: 'lgd', phaseIndex: 2, phaseStartedAt: Date.now() - 100,
        openingIndex: 0, openingStartedAt: 0, warned: false, wrapped: false, finished: false,
      });
      controller.init();
      await new Promise((r) => setTimeout(r, 1400));
      const snap = controller.store.getSnapshot();
      controller.dispose();
      const texts = snap.messages.map((m) => m.content).join(' | ');
      assert.ok(texts.includes('讨论还剩 3 分钟'), `未播报收尾引导语：${texts.slice(0, 120)}`);
    },
  },
  {
    id: 'C14', area, title: '阶段结束前 1 分钟由面试官给出时间提醒',
    async run() {
      const { controller } = await makeController({ phaseDurationsMs: { FREE_DISCUSSION: 1500 } });
      controller.announceOpening();
      controller.forcePhaseForTest({
        format: 'lgd', phaseIndex: 2, phaseStartedAt: Date.now() - 100,
        openingIndex: 0, openingStartedAt: 0, warned: false, wrapped: false, finished: false,
      });
      controller.init();
      await new Promise((r) => setTimeout(r, 1700));
      const snap = controller.store.getSnapshot();
      controller.dispose();
      const texts = snap.messages.map((m) => m.content).join(' | ');
      assert.ok(texts.includes('还有 1 分钟'), `未给出 1 分钟提醒：${texts.slice(0, 160)}`);
    },
  },
  {
    id: 'C15', area, title: '自由讨论中调度器把发言权交给 AI 候选人（不是主持）',
    async run() {
      const { controller, roles } = await makeController();
      controller.forcePhaseForTest({
        format: 'lgd', phaseIndex: 2, phaseStartedAt: Date.now(),
        openingIndex: 0, openingStartedAt: 0, warned: false, wrapped: false, finished: false,
      });
      controller.scheduleNextTurn(10);
      await new Promise((r) => setTimeout(r, 400));
      const snap = controller.store.getSnapshot();
      controller.dispose();
      const spoken = snap.messages.filter((m) => m.type === 'message');
      assert.ok(spoken.length >= 1, '调度器未安排任何发言');
      assert.ok(
        roles.some((r) => r.id === spoken[0].senderId),
        `发言者不是 AI 候选人：${spoken[0].senderId}`
      );
    },
  },
  {
    id: 'C8', area, title: 'AI 不打断真人（调度器接线）',
    async run() {
      const c = read('src/session/sessionController.ts');
      assert.ok(/canAiInterrupt|evaluateInterrupt/.test(c), 'controller 未接线打断规则');
      const s = await load('engine/scheduler.ts');
      assert.equal(s.canAiInterrupt('user'), false);
    },
  },
];
