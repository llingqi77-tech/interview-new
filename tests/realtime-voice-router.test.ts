import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_CARDS } from '../data/roleCards.ts';
import { HOST_CARD } from '../data/interviewerCards.ts';
import { autoSelectPanel, validatePanelSelection } from '../engine/roleSelector.ts';
import { RealtimeClient, type RealtimeClientOptions, type RealtimeEvents, type WsLike } from '../services/realtimeClient.ts';
import { RealtimePlayback } from '../services/realtimePlayback.ts';
import { RealtimeVoiceRouter } from '../services/realtimeVoiceRouter.ts';
import { resolveVoiceBinding } from '../services/voiceBinding.ts';
import { SessionController, type SessionDeps } from '../src/session/sessionController.ts';
import type { RoleCard, SimulationState } from '../types.ts';

/**
 * 多角色全双工：耳会话只听，嘴会话按音色去重播报。
 * 无真实 STEPFUN_API_KEY 时全部走 mock WebSocket，不连上游。
 */

class MockWs implements WsLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: { code?: number }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(obj: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  sentJson(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

class FakePlayback {
  enqueueCalls: string[] = [];
  stopped = 0;
  playing = false;
  enqueue(b64: string): void {
    this.enqueueCalls.push(b64);
    this.playing = true;
  }
  stop(): void {
    this.stopped += 1;
    this.playing = false;
  }
  getPlaybackAnalyser(): null {
    return null;
  }
  dispose(): void {
    this.stop();
  }
}

function sessionUpdate(ws: MockWs): { session: Record<string, unknown> } | undefined {
  return ws.sentJson().find((m) => m.type === 'session.update') as { session: Record<string, unknown> } | undefined;
}

async function connectRouter(speakers: { roleId: string; voice: RoleCard['voice'] }[]) {
  const sockets: MockWs[] = [];
  const playbacks: FakePlayback[] = [];
  let micStarts = 0;
  const events: RealtimeEvents = {
    onVadStart: () => undefined,
    onVadStop: () => undefined,
    onUserTranscript: () => undefined,
    onError: () => undefined,
    onClose: () => undefined,
  };
  const router = await RealtimeVoiceRouter.connect({
    speakers,
    earEvents: events,
    createClient: (opts) =>
      RealtimeClient.create({
        ...opts,
        fetchFn: (async () =>
          new Response(JSON.stringify({ token: 't.sig', model: 'stepaudio-3-realtime-preview' }), {
            status: 200,
          })) as typeof fetch,
        wsFactory: () => {
          const ws = new MockWs();
          sockets.push(ws);
          return ws;
        },
        micFactory: async () => {
          micStarts += 1;
          return { stop() {} };
        },
        playbackFactory: () => {
          const playback = new FakePlayback();
          playbacks.push(playback);
          return playback as unknown as RealtimePlayback;
        },
        confirmWindowMs: 50,
        cooldownMs: 0,
      }),
  });
  return { router, sockets, playbacks, micStarts: () => micStarts };
}

const card = (id: string): RoleCard => ROLE_CARDS.find((c) => c.id === id)!;

test('音色解析：旧 TTS ID 映射，系统音色与复刻 ID 原样透传', () => {
  const legacy = resolveVoiceBinding({ voice_id: 'zhengpaiqingnian' });
  assert.equal(legacy.realtimeVoiceId, 'zhengpaiqingnian');
  assert.equal(legacy.cloned, false);
  assert.equal(legacy.source, 'system');
  const rejected = resolveVoiceBinding({ voice_id: 'ganliannvsheng' });
  assert.equal(rejected.realtimeVoiceId, 'elegantgentle-female');
  assert.equal(rejected.source, 'legacy-map');
  assert.equal(resolveVoiceBinding({ voice_id: 'shuangkuainansheng' }).realtimeVoiceId, 'yuanqinansheng');

  const system = resolveVoiceBinding({ voice_id: 'livelybreezy-female' });
  assert.equal(system.realtimeVoiceId, 'livelybreezy-female');
  assert.equal(system.source, 'system');

  const clone = resolveVoiceBinding({ voice_id: 'clone_user_voice_42' });
  assert.equal(clone.realtimeVoiceId, 'clone_user_voice_42');
  assert.equal(clone.cloned, true);
  assert.equal(clone.source, 'clone');

  const explicit = resolveVoiceBinding({ voice_id: 'shenchennanyin', realtime_voice_id: 'clone_host_01' });
  assert.equal(explicit.realtimeVoiceId, 'clone_host_01');
  assert.equal(explicit.source, 'explicit');
  assert.equal(explicit.cloned, true);

  assert.equal(resolveVoiceBinding(HOST_CARD.voice).realtimeVoiceId, 'linjiajiejie');
  assert.equal(resolveVoiceBinding(HOST_CARD.voice).source, 'system');
  assert.equal(
    resolveVoiceBinding(HOST_CARD.voice).realtimeVoiceId,
    resolveVoiceBinding({ voice_id: HOST_CARD.voice.voice_id }).realtimeVoiceId,
    '主持的 TTS 与 Realtime 共用 linjiajiejie'
  );
});

test('耳会话只听，嘴会话按解析后的音色去重，复刻 ID 原样写入 voice', async () => {
  const h = await connectRouter([
    { roleId: 'tech_visionary', voice: card('tech_visionary').voice },
    { roleId: 'crypto_pioneer', voice: card('crypto_pioneer').voice },
    { roleId: 'clone_role', voice: { provider: 'stepfun', voice_id: 'clone_user_voice_42', rate: 1, emotion_default: 'neutral' } },
  ]);
  assert.equal(h.router.mouthCount, 2, '两张同 TTS 音色的卡应共用一条嘴会话，加上复刻音色共 2 条');
  h.router.start();
  assert.equal(h.sockets.length, 3, '1 耳 + 2 嘴');
  h.sockets.forEach((ws) => ws.open());
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.micStarts(), 1, '只有耳会话采集麦克风');

  const ear = h.sockets.find((ws) => String(sessionUpdate(ws)?.session.instructions ?? '').includes('听写'));
  assert.ok(ear, '耳会话应使用听写指令');
  assert.equal(sessionUpdate(ear!)?.session.voice, undefined, '耳会话不锁定音色');
  assert.equal((sessionUpdate(ear!)?.session.turn_detection as { type?: string } | undefined)?.type, 'server_vad');

  const youth = h.sockets.find((ws) => sessionUpdate(ws)?.session.voice === 'zhengpaiqingnian');
  const clone = h.sockets.find((ws) => sessionUpdate(ws)?.session.voice === 'clone_user_voice_42');
  assert.ok(youth, '正派青年音色应原样作为 Realtime voice');
  assert.ok(clone, '复刻音色 ID 应原样作为 voice');
  assert.equal(sessionUpdate(youth!)?.session.turn_detection, undefined, '嘴会话关闭 VAD');
  assert.equal(sessionUpdate(clone!)?.session.turn_detection, undefined);

  assert.equal(h.router.speak('tech_visionary', '先做用户调研'), true);
  assert.equal(h.router.speak('crypto_pioneer', '我补充增长数据'), true);
  const youthText = youth!.sentJson().filter((m) => m.type === 'conversation.item.create');
  assert.equal(youthText.length, 2, '同音色的两个角色走同一条连接');
  assert.ok(JSON.stringify(youthText).includes('用户调研'));
  assert.ok(JSON.stringify(youthText).includes('说话人：tech_visionary'));
  assert.ok(JSON.stringify(youthText).includes('增长数据'));
  assert.equal(clone!.sentJson().filter((m) => m.type === 'conversation.item.create').length, 0);

  const before = h.playbacks.reduce((n, p) => n + p.enqueueCalls.length, 0);
  ear!.emit({ type: 'response.audio.delta', delta: 'QQ==' });
  assert.equal(
    h.playbacks.reduce((n, p) => n + p.enqueueCalls.length, 0),
    before,
    '耳会话的模型音频必须丢弃'
  );
  youth!.emit({ type: 'response.audio.delta', delta: 'QQ==' });
  assert.equal(h.playbacks.reduce((n, p) => n + p.enqueueCalls.length, 0), before + 1);

  ear!.emit({ type: 'input_audio_buffer.speech_started' });
  assert.ok(youth!.sentJson().some((m) => m.type === 'response.cancel'), '用户开口应立刻取消嘴会话');
  assert.ok(clone!.sentJson().some((m) => m.type === 'response.cancel'));

  clone!.emit({ type: 'error', error: { type: 'invalid_request_error', message: 'unknown voice clone_user_voice_42' } });
  assert.equal(h.router.speak('clone_role', '这句应改走 TTS'), false);
  h.router.dispose();
});

test('嘴会话尚未 open 时台词排队，open 后冲刷', async () => {
  const h = await connectRouter([{ roleId: 'ib_analyst', voice: card('ib_analyst').voice }]);
  h.router.start();
  // start 顺序固定：先耳，再嘴。session.update 要等 open 才发出，所以这里按下标取嘴。
  assert.equal(h.sockets.length, 2);
  const mouth = h.sockets[1];
  assert.equal(h.router.speak('ib_analyst', '请先自我介绍'), true);
  assert.equal(h.router.isAIPlaying(), true, '排队中的台词也应挡住下一位');
  assert.equal(mouth.sent.length, 0);
  mouth.open();
  assert.equal(sessionUpdate(mouth)?.session.voice, 'elegantgentle-female');
  const sent = mouth.sentJson().filter((m) => m.type === 'conversation.item.create');
  assert.equal(sent.length, 1);
  assert.ok(JSON.stringify(sent[0]).includes('自我介绍'));
  h.router.dispose();
});

test('结构化单面：2 与 3 位面试官都合法，自动分配人数正确', () => {
  for (const count of [2, 3] as const) {
    for (let seed = 1; seed <= 30; seed++) {
      const picked = autoSelectPanel('finance', seed, count);
      assert.equal(picked.length, count, `seed=${seed} count=${count}`);
      assert.deepEqual(validatePanelSelection(picked, count), []);
    }
  }
  assert.equal(autoSelectPanel('tech', 7, 3).length, 3);
  const two = card('tech_visionary');
  const three = [two, card('product_legend')];
  assert.ok(validatePanelSelection(three, 3).some((v) => v.rule === 'count'));
  assert.deepEqual(validatePanelSelection(three, 2), []);
});

test('会话接线：AI 台词进对应嘴会话，转写仍归属 ai:<roleId>；嘴失败则不占 Realtime', async () => {
  const spoken: { channel?: string; voice?: string; text: string }[] = [];
  const mouths: string[] = [];
  const makeClient = (opts: RealtimeClientOptions) => {
    if (opts.channel === 'mouth' && opts.voice) mouths.push(opts.voice);
    return {
      state: 'open',
      start() {},
      stop() {},
      dispose() {},
      setMuted() {},
      setLocalBargeHandler() {},
      speak(text: string) {
        spoken.push({ channel: opts.channel, voice: opts.voice, text });
      },
      stopAISpeech() {},
      isAIPlaying() {
        return false;
      },
      getPlaybackAnalyser() {
        return null;
      },
    } as unknown as RealtimeClient;
  };
  const state: SimulationState = {
    topic: '是否应在全行业推行远程办公？',
    jobTitle: '产品经理',
    company: '测试公司',
    status: 'DISCUSSING',
    format: 'lgd',
  };
  const roles = [card('ib_analyst'), card('strategy_consultant'), card('ops_director')];
  const deps = (overrides: Partial<SessionDeps> = {}): SessionDeps => ({
    state,
    roles,
    sessionId: null,
    consentSaveTranscript: false,
    cameraEnabled: false,
    facingMode: 'user',
    format: 'lgd',
    onFinish: () => undefined,
    generateReply: async () => ({ content: '我先对齐一下目标。', emotion: 'neutral', target: null, stepfun_tts_instruction: null }),
    createRealtimeClient: async (opts) => makeClient(opts),
    ...overrides,
  });

  const c = new SessionController(deps());
  await c.initRealtime();
  assert.equal(c.store.getSnapshot().realtimeStatus, 'active');
  assert.ok(mouths.includes('linjiajiejie'), '无领导讨论应为主持单开音色');
  assert.equal(new Set(mouths).size, 4, '3 位候选人 + 主持，四把不同的声音');
  c.forcePhaseForTest({ format: 'lgd' as const, phaseIndex: 2, phaseStartedAt: Date.now(), openingIndex: 4, openingStartedAt: Date.now(), warned: false, wrapped: false, finished: false });
  await c.triggerAITurn(roles[0], { speakerKind: 'candidate', force: true });
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].channel, 'mouth');
  assert.equal(spoken[0].voice, 'elegantgentle-female');
  assert.ok(spoken[0].text.includes('对齐'));
  const msg = c.store.getSnapshot().messages[0];
  assert.equal(msg.speaker, 'ai:ib_analyst');
  assert.equal(msg.senderId, 'ib_analyst');
  assert.equal(msg.source, 'llm');
  c.dispose();

  const panelMouths: string[] = [];
  const panel = new SessionController(
    deps({
      format: 'panel',
      roles: roles.slice(0, 2),
      createRealtimeClient: async (opts) => {
        if (opts.channel === 'mouth' && opts.voice) panelMouths.push(opts.voice);
        return makeClient(opts);
      },
    })
  );
  await panel.initRealtime();
  assert.equal(panelMouths.length, 2);
  assert.ok(!panelMouths.includes('linjiajiejie'), '结构化单面不加入主持音色');
  panel.dispose();

  const down = new SessionController(
    deps({
      createRealtimeClient: async (opts) => {
        if (opts.channel === 'mouth') throw new Error('mouth unavailable');
        return makeClient(opts);
      },
    })
  );
  await down.initRealtime();
  assert.equal(down.store.getSnapshot().realtimeStatus, 'active', '耳会话仍在，用户侧保持全双工');
  down.forcePhaseForTest({ format: 'lgd' as const, phaseIndex: 2, phaseStartedAt: Date.now(), openingIndex: 4, openingStartedAt: Date.now(), warned: false, wrapped: false, finished: false });
  const before = spoken.length;
  await down.triggerAITurn(roles[1], { speakerKind: 'candidate', force: true });
  assert.equal(spoken.length, before, '嘴会话失败时不应再走 Realtime 播报');
  assert.equal(down.store.getSnapshot().messages.at(-1)?.speaker, 'ai:strategy_consultant');
  down.dispose();
});
