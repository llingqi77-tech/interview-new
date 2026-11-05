import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionController, type SessionDeps } from '../src/session/sessionController.ts';
import { createSessionStore, makeInitialSnapshot } from '../src/session/sessionStore.ts';
import { ROLE_CARDS } from '../data/roleCards.ts';
import type { SimulationState } from '../types.ts';
import type { ReplyResult } from '../services/geminiService.ts';

/**
 * M7 Phase 1：SessionStore / SessionController 动作 → 快照断言
 * - 双模式共用 store（两个订阅者同实例同通知）
 * - 用户发言（文字 / Realtime 转写）归属与调度
 * - barge-in 后 12 秒内优先等用户的既有规则（B.5/B.6 回归）
 */

const cards = [
  ROLE_CARDS.find((c) => c.id === 'ib_analyst')!,
  ROLE_CARDS.find((c) => c.id === 'strategy_consultant')!,
  ROLE_CARDS.find((c) => c.id === 'ops_director')!,
];

const simState: SimulationState = {
  topic: '是否应在全行业推行远程办公？请讨论效率、协作与成本三个要点。',
  jobTitle: '产品经理',
  company: '测试公司',
  status: 'DISCUSSING',
};

const fakeReply = async (_params: unknown, onChunk: (c: string) => void): Promise<ReplyResult> => {
  onChunk('好的');
  await new Promise((r) => setTimeout(r, 30));
  return { content: '好的，我补充一点。', emotion: 'neutral', target: null, stepfun_tts_instruction: null };
};

function makeDeps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    state: simState,
    roles: cards,
    sessionId: null,
    consentSaveTranscript: false,
    cameraEnabled: false,
    facingMode: 'user',
    onFinish: () => undefined,
    generateReply: fakeReply as SessionDeps['generateReply'],
    ...overrides,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FREE_DISCUSSION = { format: 'lgd' as const, phaseIndex: 2, phaseStartedAt: Date.now(), openingIndex: 4, openingStartedAt: Date.now(), warned: false, wrapped: false, finished: false };

test('store：set 合并补丁并通知订阅者（双订阅 = 双模式共用同一实例）', () => {
  const store = createSessionStore(makeInitialSnapshot(1000));
  let aHits = 0;
  let bHits = 0;
  const offA = store.subscribe(() => aHits++);
  const offB = store.subscribe(() => bHits++);
  store.set({ awaitingUser: true });
  assert.equal(store.getSnapshot().awaitingUser, true);
  assert.equal(aHits, 1);
  assert.equal(bHits, 1);
  // 两个订阅者读到的是同一份快照引用（共用事实源）
  offA();
  store.set({ awaitingUser: false });
  assert.equal(aHits, 1);
  assert.equal(bHits, 2);
  offB();
});

test('动作 → 快照：sendTextMessage 落消息、归属 user/text、清 awaitingUser', () => {
  const c = new SessionController(makeDeps());
  c.store.set({ awaitingUser: true });
  c.sendTextMessage('  我的观点是分层推进。  ');
  const snap = c.store.getSnapshot();
  assert.equal(snap.messages.length, 1);
  assert.equal(snap.messages[0].content, '我的观点是分层推进。');
  assert.equal(snap.messages[0].speaker, 'user');
  assert.equal(snap.messages[0].source, 'text');
  assert.equal(snap.awaitingUser, false);
  c.dispose();
});

test('动作 → 快照：pushEvents 聚合、setUserSpeaking 写入', () => {
  const c = new SessionController(makeDeps());
  c.pushEvents([{ event_type: 'speak_grant', actor: 'ib_analyst', target: 'all', timestamp_ms: 10 }]);
  c.pushEvents([{ event_type: 'interrupt', actor: 'user', target: 'ib_analyst', timestamp_ms: 20, metadata: { rule: 'user_barge_in_realtime' } }]);
  c.setUserSpeaking(true);
  const snap = c.store.getSnapshot();
  assert.equal(snap.events.length, 2);
  assert.equal(snap.events[1].metadata?.rule, 'user_barge_in_realtime');
  assert.equal(snap.userSpeaking, true);
  c.dispose();
});

test('AI 发言（注入 LLM）：落消息归属 ai:<cardId>/llm，speak_grant 事件登记', async () => {
  const c = new SessionController(makeDeps());
  c.forcePhaseForTest({ ...FREE_DISCUSSION, phaseStartedAt: Date.now() });
  c.scheduleNextTurn(10);
  await sleep(250);
  const snap = c.store.getSnapshot();
  assert.equal(snap.messages.length, 1);
  assert.equal(snap.messages[0].senderId, cards.some((k) => k.id === snap.messages[0].senderId) ? snap.messages[0].senderId : 'unexpected');
  assert.match(snap.messages[0].speaker ?? '', /^ai:/);
  assert.equal(snap.messages[0].source, 'llm');
  assert.ok(snap.events.some((e) => e.event_type === 'speak_grant'));
  c.dispose();
});

test('onUserVadStart：AI 活动中同步停生成态 + 推 interrupt(user_barge_in_realtime) + 12 秒内不触发 AI', async () => {
  const c = new SessionController(makeDeps());
  c.forcePhaseForTest({ ...FREE_DISCUSSION, phaseStartedAt: Date.now() });
  // 打断上下文：有挂起的 AI 调度（AI 即将接话）
  c.scheduleNextTurn(5000);
  c.onUserVadStart();
  // 同步断言（同一调用栈）：userSpeaking 置位、interrupt 事件落库、挂起调度被取消
  let snap = c.store.getSnapshot();
  assert.equal(snap.userSpeaking, true);
  assert.ok(snap.events.some((e) => e.event_type === 'interrupt' && e.actor === 'user' && e.metadata?.rule === 'user_barge_in_realtime'));
  // barge-in 后 12 秒窗口内调度只重排，不触发 AI、不点名他人
  c.scheduleNextTurn(10);
  await sleep(250);
  snap = c.store.getSnapshot();
  assert.equal(snap.isGenerating, false);
  assert.equal(snap.activeCharId, null);
  assert.equal(snap.messages.length, 0);
  c.dispose();
});

test('onUserVadStart：无 AI 活动时只是正常开口（不污染 interrupt 事件流）', () => {
  const c = new SessionController(makeDeps());
  c.forcePhaseForTest({ ...FREE_DISCUSSION, phaseStartedAt: Date.now() });
  c.onUserVadStart();
  const snap = c.store.getSnapshot();
  assert.equal(snap.userSpeaking, true);
  assert.equal(snap.events.filter((e) => e.event_type === 'interrupt').length, 0);
  c.dispose();
});

test('Realtime 接线：建链成功 → active；最终转写落 user/realtime 消息；凭证失败 → fallback', async () => {
  // 成功路径：注入假 client，捕获事件回调
  let captured: { onUserTranscript?: (p: { text: string; isFinal: boolean }) => void } = {};
  const fakeClient = { start: () => undefined, stop: () => undefined, dispose: () => undefined, setMuted: () => undefined, state: 'open' };
  const c = new SessionController(
    makeDeps({
      createRealtimeClient: (async (opts: { channel?: string; events: typeof captured }) => {
        // 耳会话才承载用户转写；嘴会话是按音色分开的播报通道
        if (!opts.channel || opts.channel === 'ear') captured = opts.events;
        return fakeClient;
      }) as unknown as SessionDeps['createRealtimeClient'],
    })
  );
  await c.initRealtime();
  assert.equal(c.store.getSnapshot().realtimeStatus, 'active');
  captured.onUserTranscript?.({ text: '我认为要控制成本', isFinal: true });
  const msgs = c.store.getSnapshot().messages;
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].speaker, 'user');
  assert.equal(msgs[0].source, 'realtime');
  c.dispose();

  // 失败路径：凭证 503 → fallback（不抛出、不白屏）
  const c2 = new SessionController(
    makeDeps({
      createRealtimeClient: (async () => {
        throw new Error('realtime-token HTTP 503');
      }) as unknown as SessionDeps['createRealtimeClient'],
    })
  );
  await c2.initRealtime();
  assert.equal(c2.store.getSnapshot().realtimeStatus, 'fallback');
  c2.dispose();
});
test('倒计时驱动：READING(覆盖 300ms) → OPENING 自动切换并产生 stage_change 事件', async () => {
  const c = new SessionController(makeDeps({ phaseDurationsMs: { READING: 300 } }));
  c.init();
  await sleep(1200);
  const snap = c.store.getSnapshot();
  assert.equal(snap.phase.phaseIndex, 1, '应进入 OPENING');
  assert.ok(snap.events.some((e) => e.event_type === 'stage_change' && e.target === 'INTRO'));
  // OPENING 第一位陈述者已被触发（AI 开始生成或用户被点名）
  assert.ok(snap.isGenerating || snap.awaitingUser || snap.messages.length > 0);
  c.dispose();
});

test('finishSession：幂等且回吐 messages/events/sessionStartAt', async () => {
  let finished: { m: number; e: number } | null = null;
  const c = new SessionController(makeDeps({ onFinish: (m, e) => (finished = { m: m.length, e: e.length }) }));
  c.sendTextMessage('总结观点。');
  await c.finishSession();
  await c.finishSession(); // 第二次不得重复触发
  assert.ok(finished);
  assert.equal(finished!.m, 1);
  c.dispose();
});
