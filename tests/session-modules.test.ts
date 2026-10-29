import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateSpeechMs, speechMsFromCharCount, userReplyDelayMs } from '../engine/speechRate.ts';
import { buildOpeningOrder } from '../engine/openingOrder.ts';
import { KeyPointTracker } from '../engine/keyPointTracker.ts';
import { MAX_DISCUSSIONS_PER_KEY_POINT } from '../engine/keyPoints.ts';
import { SaveQueue } from '../src/session/saveQueue.ts';
import { collectVoiceSpeakers } from '../src/session/voiceRoster.ts';
import { buildUserMessage, interruptEvent } from '../src/session/transcript.ts';
import { buildReplyParams } from '../src/session/replyRequest.ts';
import { HOST_CARD } from '../data/interviewerCards.ts';
import { ROLE_CARDS } from '../data/roleCards.ts';
import { SessionController, type SessionDeps } from '../src/session/sessionController.ts';
import type { RoleCard, SimulationState } from '../types.ts';
import type { ReplyResult } from '../services/geminiService.ts';

const cards = [
  ROLE_CARDS.find((card) => card.id === 'ib_analyst')!,
  ROLE_CARDS.find((card) => card.id === 'strategy_consultant')!,
];

test('speechRate：空文本落到 800ms，长文本按 2.8 字/秒且不封顶', () => {
  assert.equal(speechMsFromCharCount(0), 0);
  assert.equal(speechMsFromCharCount(Number.NaN), 0);
  assert.equal(estimateSpeechMs(''), 800);
  assert.equal(estimateSpeechMs(null), 800);
  assert.equal(estimateSpeechMs('a'), 800);
  assert.equal(estimateSpeechMs('a'.repeat(28)), 10_000);
  assert.equal(userReplyDelayMs('a'.repeat(280)), 6_000);
});

test('openingOrder：panel 只有用户；lgd 把用户插进指定位置', () => {
  assert.deepEqual(buildOpeningOrder(cards, 'panel', () => 0), ['user']);
  assert.deepEqual(buildOpeningOrder(cards, 'lgd', () => 0), ['user', cards[0].id, cards[1].id]);
  assert.deepEqual(buildOpeningOrder(cards, 'lgd', () => 0.99), [cards[0].id, cards[1].id, 'user']);
  assert.deepEqual(buildOpeningOrder([{ id: '' } as RoleCard], 'lgd', () => 0), ['user']);
});

test('KeyPointTracker：满次数或引导下一要点才推进；空列表是空操作', () => {
  const tracker = new KeyPointTracker();
  tracker.reset(null);
  tracker.noteUtterance();
  assert.equal(tracker.advanceIfReady('接下来讨论方案'), false);

  tracker.reset(['效率', '协作']);
  for (let i = 0; i < MAX_DISCUSSIONS_PER_KEY_POINT - 1; i += 1) tracker.noteUtterance();
  assert.equal(tracker.advanceIfReady('还在聊效率'), false);
  tracker.noteUtterance();
  assert.equal(tracker.advanceIfReady('到上限了'), true);
  assert.equal(tracker.current, '协作');
  assert.equal(tracker.discussionCount, 0);

  tracker.noteUtterance();
  assert.equal(tracker.advanceIfReady('接下来我们讨论收尾'), true);
  assert.equal(tracker.allDiscussed, true);
  assert.equal(tracker.current, null);
  assert.equal(tracker.shouldAdvancePhase('我来总结', 0.1), true);
  assert.equal(tracker.shouldAdvancePhase('继续聊', 0.9), false);
});

test('SaveQueue：失败只记日志；挂死的落库最多等到超时', async () => {
  const errors: unknown[] = [];
  const queue = new SaveQueue((error) => errors.push(error));
  await queue.flush();
  queue.track(Promise.reject(new Error('db down')));
  await queue.flush(20);
  assert.equal(errors.length, 1);
  assert.equal(queue.size, 0);

  let finished = false;
  queue.track(new Promise(() => undefined));
  await queue.flush(15);
  finished = true;
  assert.equal(finished, true);
  assert.equal(queue.size, 0);
});

test('voiceRoster：lgd 加主持并去重，panel 不加主持', () => {
  const lgd = collectVoiceSpeakers('lgd', [...cards, cards[0]]);
  assert.equal(lgd.filter((speaker) => speaker.roleId === cards[0].id).length, 1);
  assert.equal(lgd.at(-1)?.roleId, HOST_CARD.id);

  const panel = collectVoiceSpeakers('panel', cards);
  assert.equal(panel.some((speaker) => speaker.roleId === HOST_CARD.id), false);
  assert.equal(panel.length, 2);
});

test('transcript / replyRequest：用户消息与打断事件字段完整', () => {
  const message = buildUserMessage({
    text: '我的观点',
    sentAt: 5_000,
    sessionStartAt: 1_000,
    source: 'text',
    senderName: '陈明',
  });
  assert.equal(message.speaker, 'user');
  assert.equal(message.startMs, 4_000);
  assert.ok((message.endMs ?? 0) >= 4_800);

  const event = interruptEvent('user', 'ib_analyst', 40, 'user_barge_in_realtime');
  assert.equal(event.event_type, 'interrupt');
  assert.equal(event.metadata?.rule, 'user_barge_in_realtime');

  const params = buildReplyParams({
    card: cards[0],
    topic: '题目',
    jobTitle: '产品经理',
    history: [],
    phase: '自由讨论',
    currentKeyPoint: '效率',
    keyPointDiscussionCount: 2,
    allKeyPointsDiscussed: false,
    allKeyPoints: ['效率'],
    currentKeyPointIndex: 0,
    voiceMode: true,
    speakerKind: 'candidate',
    phaseRemainingMs: 1_000,
    sessionId: null,
  });
  assert.equal(params.speakerKind, 'candidate');
  assert.equal(params.sessionId, null);
});

test('已释放的会话不再接收新发言，也不把在途台词落库', async () => {
  let release: ((result: ReplyResult) => void) | null = null;
  const state: SimulationState = {
    topic: '是否应在全行业推行远程办公？',
    jobTitle: '产品经理',
    company: '测试公司',
    status: 'DISCUSSING',
  };
  const deps: SessionDeps = {
    state,
    roles: cards,
    sessionId: null,
    consentSaveTranscript: false,
    cameraEnabled: false,
    facingMode: 'user',
    onFinish: () => undefined,
    generateReply: () =>
      new Promise<ReplyResult>((resolve) => {
        release = resolve;
      }),
  };
  const controller = new SessionController(deps);
  controller.forcePhaseForTest({
    phaseIndex: 2,
    phaseStartedAt: Date.now(),
    openingIndex: 4,
    openingStartedAt: Date.now(),
    finished: false,
  });
  const turn = controller.triggerAITurn(cards[0], { force: true });
  controller.dispose();
  release?.({ content: '这句不该留下', emotion: 'neutral', target: null, stepfun_tts_instruction: null });
  await turn;
  assert.equal(controller.store.getSnapshot().messages.length, 0);
  controller.sendTextMessage('释放后也不该留下');
  assert.equal(controller.store.getSnapshot().messages.length, 0);
});
