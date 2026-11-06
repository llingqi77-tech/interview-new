import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setPoolForTesting } from '../api/_lib/db.ts';
import sessionItemHandler from '../api/_sessions/[id]/index.ts';
import analyzeHandler from '../api/_sessions/[id]/analyze.ts';
import reportHandler from '../api/_sessions/[id]/report.ts';
import eventsHandler from '../api/events.ts';
import avatarsHandler from '../api/avatars.ts';
import llmHandler from '../api/llm.ts';
import sessionHandler from '../api/session.ts';
import { SessionController, type SessionDeps } from '../src/session/sessionController.ts';
import { ROLE_CARDS } from '../data/roleCards.ts';
import type { SimulationState } from '../types.ts';
import type { ReplyParams, ReplyResult } from '../services/geminiService.ts';
import { RealtimeClient } from '../services/realtimeClient.ts';
import { RealtimePlayback } from '../services/realtimePlayback.ts';
import { VoiceLanePool, isFatalLaneError } from '../services/voiceLanes.ts';
import { createStringFieldReader } from '../api/_lib/jsonStream.ts';

/**
 * 缺陷回归测试（2026-10 审计修复批次）
 * 每条断言对应一个已修复的真实缺陷：修复前必失败，修复后必须通过。
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

// ---------- 会话引擎 ----------

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 手动驱动 controller 的 tick（避免 init() 的 setInterval 在断言失败时泄漏导致测试进程挂住） */
async function driveTicks(c: SessionController, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    (c as unknown as { tick(): void }).tick();
    await sleep(25);
  }
}

const FREE_DISCUSSION = { format: 'lgd' as const, phaseIndex: 2, phaseStartedAt: Date.now(), openingIndex: 4, openingStartedAt: Date.now(), warned: false, wrapped: false, finished: false };
const OPENING = { format: 'lgd' as const, phaseIndex: 1, phaseStartedAt: Date.now(), openingIndex: 0, openingStartedAt: Date.now(), warned: false, wrapped: false, finished: false };
const READING = { format: 'lgd' as const, phaseIndex: 0, phaseStartedAt: Date.now(), openingIndex: 0, openingStartedAt: Date.now(), warned: false, wrapped: false, finished: false };

function makeDeps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    state: simState,
    roles: cards,
    sessionId: null,
    consentSaveTranscript: false,
    cameraEnabled: false,
    facingMode: 'user',
    onFinish: () => undefined,
    generateReply: (async (_p: ReplyParams, onChunk: (c: string) => void): Promise<ReplyResult> => {
      onChunk('好的');
      await sleep(10);
      return { content: '这是一段测试台词。', emotion: 'neutral', target: null, stepfun_tts_instruction: null };
    }) as SessionDeps['generateReply'],
    ...overrides,
  };
}

test('缺陷回归 · panel：调度器驱动的面试官回合必须走 interviewer 身份并把话筒交给用户', async () => {
  const seen: string[] = [];
  const c = new SessionController(
    makeDeps({
      format: 'panel',
      roles: cards.slice(0, 2),
      generateReply: (async (p: ReplyParams, _onChunk: (c: string) => void): Promise<ReplyResult> => {
        seen.push(p.speakerKind);
        return { content: '请介绍一下你的项目经历。', emotion: 'neutral', target: 'user', stepfun_tts_instruction: null };
      }) as SessionDeps['generateReply'],
    })
  );
  c.forcePhaseForTest({ ...FREE_DISCUSSION, phaseStartedAt: Date.now() });
  await c.triggerAITurn(cards[0]);
  assert.deepEqual(seen, ['interviewer'], 'panel 阵型的角色默认身份必须是 interviewer（否则走群面候选人 prompt）');
  assert.equal(c.store.getSnapshot().awaitingUser, true, '面试官问完必须点名用户（awaitingUser）');
  c.dispose();
});

test('缺陷回归 · 打断：用户在 AI 生成期间插话 → 这句台词被丢弃（不播报、不落消息、不夺发言权）', async () => {
  let release: ((r: ReplyResult) => void) | null = null;
  const c = new SessionController(
    makeDeps({
      generateReply: (async (): Promise<ReplyResult> => {
        await new Promise<ReplyResult>((resolve) => {
          release = resolve;
        });
        return { content: 'AI 早就写好但已被打断的台词', emotion: 'neutral', target: null, stepfun_tts_instruction: null };
      }) as SessionDeps['generateReply'],
    })
  );
  c.forcePhaseForTest({ ...FREE_DISCUSSION, phaseStartedAt: Date.now() });
  const turn = c.triggerAITurn(cards[0]);
  await sleep(30);
  assert.equal(c.store.getSnapshot().isGenerating, true, 'AI 应处于生成中');
  // 用户开口打断
  c.onUserVadStart();
  release!({ content: 'AI 早就写好但已被打断的台词', emotion: 'neutral', target: null, stepfun_tts_instruction: null });
  await turn;
  const snap = c.store.getSnapshot();
  assert.equal(snap.messages.length, 0, '被打断的回合不应落进转写');
  assert.equal(snap.speakingCharId, null, '被打断的回合不应点亮发言高亮');
  c.dispose();
});

const SELF_INTRO = { ...OPENING, phaseIndex: 0 };

test('缺陷回归 · panel：自我介绍没说完时不进问答；审题阶段说过话也不算数', async () => {
  // 场景 A：OPENING 阶段用户说了很长的话（估算还要说很久）→ 不应进问答
  const c1 = new SessionController(makeDeps({ format: 'panel', roles: cards.slice(0, 2), panelOpeningAdvanceMs: 20 }));
  c1.forcePhaseForTest({ ...SELF_INTRO, phaseStartedAt: Date.now() });
  c1.sendTextMessage('我'.repeat(200)); // 估算发言时长 ~71s
  await driveTicks(c1, 300);
  assert.equal(c1.store.getSnapshot().phase.phaseIndex, 0, '用户还在说话时不应切到问答阶段');
  c1.dispose();

  // 场景 B：审题阶段（OPENING 之前）说过话 → 自我介绍机会不能被吞掉
  const c2 = new SessionController(makeDeps({ format: 'panel', roles: cards.slice(0, 2), panelOpeningAdvanceMs: 20 }));
  c2.forcePhaseForTest({ ...READING, phaseStartedAt: Date.now() });
  c2.sendTextMessage('读题阶段先说了一句');
  c2.forcePhaseForTest({ ...SELF_INTRO, phaseStartedAt: Date.now() }); // 随后进入自我介绍阶段
  await driveTicks(c2, 300);
  assert.equal(c2.store.getSnapshot().phase.phaseIndex, 0, '审题阶段的发言不得被当成「自我介绍已完成」');
  c2.dispose();
});

test('缺陷回归 · StrictMode 双挂载：dispose 后再次 init 必须能重新建链并继续发言', async () => {
  const fakeClient = {
    start: () => undefined,
    stop: () => undefined,
    dispose: () => undefined,
    setMuted: () => undefined,
    setLocalBargeHandler: () => undefined,
    stopAISpeech: () => undefined,
    speak: () => undefined,
    isAIPlaying: () => false,
    getPlaybackAnalyser: () => null,
    state: 'open',
  };
  const c = new SessionController(
    makeDeps({
      createRealtimeClient: (async () => fakeClient) as unknown as SessionDeps['createRealtimeClient'],
    })
  );
  try {
    c.init();
    await sleep(60);
    assert.equal(c.store.getSnapshot().realtimeStatus, 'active', '首次建链应成功');
    c.dispose(); // StrictMode：effect 卸载
    c.init(); // StrictMode：同一实例二次挂载
    await sleep(60);
    assert.equal(c.store.getSnapshot().realtimeStatus, 'active', '二次挂载必须重新建链（不能停在 connecting）');
    assert.equal(c.isRealtimeActive(), true, '二次挂载后 Realtime 链路必须重新可用');
    c.sendTextMessage('二次挂载后仍能发言');
    assert.equal(c.store.getSnapshot().messages.length, 1, '二次挂载后发言不得被丢弃（会话未结束）');
  } finally {
    c.dispose();
  }
});

test('缺陷回归 · panel：自我介绍说完后自动进入问答', async () => {
  const c = new SessionController(makeDeps({ format: 'panel', roles: cards.slice(0, 2), panelOpeningAdvanceMs: 20 }));
  c.forcePhaseForTest({ ...SELF_INTRO, phaseStartedAt: Date.now() });
  c.sendTextMessage('开场'); // 2 字 → 估算发言 ~800ms
  await driveTicks(c, 1200);
  assert.equal(c.store.getSnapshot().phase.phaseIndex, 1, '自我介绍结束（估算说完 + 等待窗）后应进入问答阶段');
  c.dispose();
});

// ---------- 数据库端点 ----------

interface Recorded {
  sql: string;
  params: unknown[];
}

function mockPool(responder?: (sql: string, params: unknown[]) => { rows: any[] }) {
  const recorded: Recorded[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    recorded.push({ sql, params });
    if (responder) return responder(sql, params);
    return { rows: [] };
  };
  const pool: any = { query, connect: async () => ({ query, release: () => undefined }) };
  return { pool, recorded };
}

function mockRes() {
  const res: any = {
    statusCode: 0,
    body: '',
    writeHead() {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = JSON.stringify(data);
      return res;
    },
    write(c: string) {
      res.body += c;
      return true;
    },
    end() {},
    on() {},
  };
  return res;
}

const originalEnv = process.env.DATABASE_URL;

beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/interview_db';
});

afterEach(() => {
  setPoolForTesting(null);
  if (originalEnv === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalEnv;
});

test('缺陷回归 · TC-11：子表删除失败（权限/锁/约束）必须整体回滚，不得谎报删除成功', async () => {
  const { pool, recorded } = mockPool((sql) => {
    if (/DELETE FROM transcripts/.test(sql)) {
      const err: any = new Error('permission denied for table transcripts');
      err.code = '42501';
      throw err;
    }
    return { rows: [] };
  });
  setPoolForTesting(pool);
  const res = mockRes();
  await sessionItemHandler({ method: 'DELETE', query: { id: '42' }, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 500, '子表删除失败时必须报错，不能回 200');
  assert.ok(
    !recorded.some((r) => /DELETE FROM sessions/.test(r.sql)),
    '子表删除失败时不得删除 sessions 行（否则子表数据成孤儿残留）'
  );
  assert.ok(recorded.some((r) => /^ROLLBACK$/i.test(r.sql.trim())), '事务必须整体回滚');
});

test('缺陷回归 · TC-11：表不存在（迁移未跑）才允许跳过该表', async () => {
  const { pool, recorded } = mockPool((sql) => {
    if (/DELETE FROM conversation_records/.test(sql)) {
      const err: any = new Error('relation "conversation_records" does not exist');
      err.code = '42P01';
      throw err;
    }
    return { rows: [] };
  });
  setPoolForTesting(pool);
  const res = mockRes();
  await sessionItemHandler({ method: 'DELETE', query: { id: '42' }, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 200, '缺表属于可跳过场景');
  assert.ok(recorded.some((r) => /DELETE FROM sessions/.test(r.sql)), '缺表时仍应删除会话');
});

test('缺陷回归 · 面后分析：会话不存在返回 404，不得凭空生成评分', async () => {
  const { pool } = mockPool((sql) => {
    if (/SELECT \* FROM sessions/.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  setPoolForTesting(pool);
  const res = mockRes();
  await analyzeHandler({ method: 'POST', query: { id: '999' }, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 404, '会话不存在应为 404');
  assert.ok(!/"overall_score"/.test(res.body), '不得为不存在的会话编造分数');
});

test('缺陷回归 · 面后分析：报告落库幂等（覆盖而不是追加多行）', async () => {
  const { pool, recorded } = mockPool((sql) => {
    if (/SELECT \* FROM sessions/.test(sql)) return { rows: [{ id: 8, topic: '群面题目', started_at: new Date(0), ended_at: new Date(60000) }] };
    return { rows: [] };
  });
  setPoolForTesting(pool);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"structure_score":80}' } }] }), { status: 200 })) as any;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  const res = mockRes();
  await analyzeHandler({ method: 'POST', query: { id: '8' }, headers: {}, socket: {} } as any, res);
  globalThis.fetch = originalFetch;
  assert.equal(res.statusCode, 200);
  const insert = recorded.find((r) => /INSERT INTO reports/.test(r.sql));
  assert.ok(insert, '报告未落库');
  assert.ok(/DELETE FROM reports WHERE session_id/.test(insert!.sql), '重跑分析必须先清掉旧报告（幂等覆盖）');
});

test('缺陷回归 · 报告读取固定取最新一条', async () => {
  const { pool, recorded } = mockPool(() => ({ rows: [{ session_id: 42, overall_score: 99 }] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await reportHandler({ method: 'GET', query: { id: '42' }, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).overall_score, 99);
  const q = recorded.find((r) => /SELECT \* FROM reports/.test(r.sql));
  assert.ok(/ORDER BY created_at DESC/.test(q!.sql), '报告读取必须有确定性排序');
  assert.ok(/LIMIT 1/.test(q!.sql), '报告读取必须只取一行');
});

test('缺陷回归 · POST /api/events 空 body 返回 400（不是 500）', async () => {
  const { pool } = mockPool(() => ({ rows: [] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await eventsHandler({ method: 'POST', body: undefined, query: {}, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 400);
});

test('缺陷回归 · GET /api/events 缺 session_id 返回 400（不是 405）', async () => {
  const { pool } = mockPool(() => ({ rows: [] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await eventsHandler({ method: 'GET', query: {}, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 400);
});

test('缺陷回归 · DELETE /api/avatars 数据库失败必须报错（不得谎报删除成功）', async () => {
  const { pool } = mockPool((sql) => {
    if (/DELETE FROM avatars/.test(sql)) throw new Error('relation "avatars" does not exist');
    return { rows: [] };
  });
  setPoolForTesting(pool);
  const res = mockRes();
  await avatarsHandler({ method: 'DELETE', query: { id: '7' }, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 500, '删除失败必须如实报错');
});

test('缺陷回归 · GET /api/session 非法 session_id 返回 400（不是 500）', async () => {
  const { pool } = mockPool(() => ({ rows: [] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await sessionHandler({ method: 'GET', query: { session_id: 'abc' }, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 400);
});

test('缺陷回归 · POST /api/llm 缺 payload 返回 400（不是 502）', async () => {
  const res = mockRes();
  await llmHandler({ method: 'POST', body: { action: 'topic' }, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 400);
});

// ---------- Realtime 语音链路 ----------

test('缺陷回归 · RealtimePlayback：播放队列排空必须回调（否则发言高亮永久悬挂）', async () => {
  let drained = 0;
  const playback = new RealtimePlayback(24000, () => {
    drained++;
  });
  // 假 AudioContext：source.onended 由测试手动触发
  const fakeCtx: any = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createBuffer: () => ({ duration: 0.1, getChannelData: () => new Float32Array(4) }),
    createBufferSource: () => ({ buffer: null, connect: () => {}, start: () => {}, stop: () => {}, onended: null }),
    createAnalyser: () => ({ fftSize: 0, connect: () => {}, getByteFrequencyData: () => {} }),
    resume: async () => undefined,
    close: async () => undefined,
  };
  (playback as any).ctx = fakeCtx;
  (playback as any).ensureAnalyser = () => null;
  // 直接调用 enqueue 的等价路径：构造 base64 PCM 分片
  const pcm = new Int16Array([1, 2, 3, 4]);
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  playback.enqueue(btoa(bin));
  assert.equal(playback.playing, true);
  // 触发源结束
  const src = (playback as any).queue[0];
  src.onended();
  assert.equal(playback.playing, false, '队列排空后 playing 必须为 false');
  assert.equal(drained, 1, '队列排空必须回调 onDrain（上层据此收敛 speakingCharId）');
});

test('缺陷回归 · RealtimeClient：连接掉线后退避窗口内状态不能仍是 open', async () => {
  let ws: any = null;
  const client = await RealtimeClient.create({
    tokenUrl: '/api/realtime-token',
    fetchFn: (async () => new Response(JSON.stringify({ token: 't', model: 'm' }), { status: 200 })) as any,
    wsFactory: (url: string) => {
      ws = {
        readyState: 1,
        sent: [] as string[],
        send(d: string) {
          this.sent.push(d);
        },
        close() {
          this.readyState = 3;
        },
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        url,
      };
      return ws;
    },
    reconnectDelaysMs: [5000],
    events: {
      onVadStart: () => undefined,
      onVadStop: () => undefined,
      onUserTranscript: () => undefined,
      onError: () => undefined,
      onClose: () => undefined,
    },
  });
  client.start();
  ws.onopen?.();
  assert.equal(client.state, 'open');
  // 掉线（未主动关闭）→ 进入退避窗口
  ws.onclose?.();
  assert.notEqual(client.state, 'open', '掉线后退避窗口内不能仍是 open（否则台词被静默丢弃）');
  client.dispose();
});

test('缺陷回归 · 嘴分路：瞬时错误不摘分路，不可恢复错误才摘', () => {
  assert.equal(isFatalLaneError('invalid_request_error'), true);
  assert.equal(isFatalLaneError('REALTIME_RECONNECT_FAILED'), true);
  assert.equal(isFatalLaneError('server_error'), false, '瞬时错误不应摘掉分路（角色会整场换声音）');
  assert.equal(isFatalLaneError(undefined), false);
});

test('缺陷回归 · JSON 流式字段提取：细碎 chunk + 冒号后有空格也必须吐增量', () => {
  // 真实上游就是这种形态：先 '{"'，再 'content'，再 '":'，再 ' "'，随后逐字到达。
  // 修复前：值起始指针停在冒号后的空格上 → 每一次 push 都返回 null → 打字机效果完全失效。
  const chunks = ['{"', 'content', '":', ' "', '先', '定', '框', '架', '。'];
  const reader = createStringFieldReader('content');
  const out: string[] = [];
  for (const c of chunks) {
    const d = reader.push(c);
    if (d) out.push(d);
  }
  assert.equal(out.join(''), '先定框架。', '细碎 chunk 下必须完整吐出 content 增量');
});

test('缺陷回归 · JSON 流式字段提取：冒号后无空格 / 键前有空白 也要正确', () => {
  for (const raw of ['{"content":"abc"}', '{"content": "abc"}', '{ "content" : "abc" }']) {
    const reader = createStringFieldReader('content');
    const out: string[] = [];
    for (let i = 0; i < raw.length; i += 3) {
      const d = reader.push(raw.slice(i, i + 3));
      if (d) out.push(d);
    }
    assert.equal(out.join(''), 'abc', `解析失败：${raw}`);
  }
});

test('缺陷回归 · 嘴分路：server_error 后分路仍在池中，invalid_request_error 才移除', async () => {
  const created: any[] = [];
  let errorSink: ((e: any) => void) | null = null;
  const fakeClient = (id: string) => {
    const c: any = {
      id,
      state: 'open',
      start: () => undefined,
      stop: () => undefined,
      dispose: () => undefined,
      stopAISpeech: () => undefined,
      isAIPlaying: () => false,
      getPlaybackAnalyser: () => null,
      speak: () => undefined,
      events: null as any,
    };
    created.push(c);
    return c;
  };
  const pool = await VoiceLanePool.create({
    voices: ['v1'],
    createClient: async (opts: any) => {
      const c = fakeClient(opts.voice);
      // 捕获池注入的事件
      queueMicrotask(() => {
        errorSink = opts.events.onError;
      });
      return c;
    },
  });
  assert.equal(pool.size, 1);
  await sleep(10);
  // 瞬时错误
  errorSink?.({ code: 'server_error', message: 'boom' });
  assert.equal(pool.size, 1, '瞬时错误不应摘掉分路');
  // 不可恢复错误
  errorSink?.({ code: 'invalid_request_error', message: 'voice rejected' });
  assert.equal(pool.size, 0, '不可恢复错误应摘掉分路');
});

// ---------- 组件层（静态接线断言） ----------

test('缺陷回归 · DeviceCheck：麦克风流与摄像头流分开持有，卸载时两条都停', () => {
  const dc = read('components/DeviceCheck.tsx');
  assert.ok(/micStreamRef/.test(dc) && /cameraStreamRef/.test(dc), '麦克风/摄像头必须分别持有流引用');
  assert.ok(
    /micStreamRef\.current\?\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/.test(dc) &&
      /cameraStreamRef\.current\?\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/.test(dc),
    '卸载时必须同时停掉麦克风与摄像头流'
  );
  assert.ok(!/streamRef\.current = stream/.test(dc), '不得再用一个 ref 覆盖两条流');
});

test('缺陷回归 · 房间：ASR 最终转写不得写两遍', () => {
  const panel = read('components/RoomStage.tsx') + read('src/session/sessionController.ts');
  assert.ok(/asrFinalRef/.test(panel), '缺少 ASR 最终转写去重标记');
  assert.ok(/finalText !== asrFinalRef\.current/.test(panel), '停止录音时不得重复追加已由回调写入的转写');
});

test('SetupForm: 题目由题型选定，进入前不提前揭题', () => {
  const setup = read('components/SetupForm.tsx');
  assert.ok(!/<textarea|<select/.test(setup));
  assert.match(setup, /pickTopic\(topicType/);
  assert.match(setup, /topic: format === 'lgd' \? entry.prompt/);
});
