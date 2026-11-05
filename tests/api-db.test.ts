import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setPoolForTesting } from '../api/_lib/db.ts';
import sessionHandler from '../api/session.ts';
import messageHandler from '../api/message.ts';
import eventsHandler from '../api/events.ts';
import feedbackHandler from '../api/feedback.ts';
import avatarsHandler from '../api/avatars.ts';
import sessionItemHandler from '../api/_sessions/[id]/index.ts';
import reportHandler from '../api/_sessions/[id]/report.ts';
import analyzeHandler from '../api/_sessions/[id]/analyze.ts';
import visualHandler from '../api/_sessions/[id]/visual.ts';

/**
 * 数据库端点测试（mock pg.Pool，验证 PRD D.2/E.1/E.2/TC-11）
 */

interface Recorded {
  sql: string;
  params: unknown[];
}

function mockPool(responder?: (sql: string, params: unknown[]) => { rows: any[] }) {
  const recorded: Recorded[] = [];
  const pool: any = {
    query: async (sql: string, params: unknown[] = []) => {
      recorded.push({ sql, params });
      if (responder) return responder(sql, params);
      return { rows: [] };
    },
    // 事务化级联删除（api/_lib/schema.ts deleteSessionCascade）经 client 走
    connect: async () => ({
      query: pool.query,
      release: () => undefined,
    }),
  };
  return { pool, recorded };
}

function mockReq(body: unknown, query: Record<string, string> = {}) {
  return { method: 'POST', body, query, headers: {}, socket: {} } as any;
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

// ---------- TC-11 / E.2：删除会话级联清理 ----------

test('TC-11: DELETE /api/sessions/{id} 级联删除全部关联表（不可恢复）', async () => {
  const { pool, recorded } = mockPool(() => ({ rows: [{ id: 42 }] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await sessionItemHandler({ method: 'DELETE', query: { id: '42' }, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 200);

  const tables = recorded.map((r) => r.sql.match(/DELETE FROM (\w+)/)?.[1]).filter(Boolean);
  for (const t of ['events', 'reports', 'visual_features', 'transcripts', 'conversation_records', 'ai_personas', 'feedback_reports', 'sessions']) {
    assert.ok(tables.includes(t), `缺少 DELETE ${t}`);
  }
  // sessions 必须最后删（外键依赖）
  assert.equal(tables[tables.length - 1], 'sessions');
  assert.equal(JSON.parse(res.body).deleted, 42);
});

test('TC-11: DELETE /api/session（旧路径）同样级联删除', async () => {
  const { pool, recorded } = mockPool(() => ({ rows: [{ id: 7 }] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await sessionHandler({ method: 'DELETE', body: { session_id: 7 }, query: {}, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 200);
  assert.ok(recorded.some((r) => /DELETE FROM sessions/.test(r.sql)));
});

// ---------- E.1：会话创建（roles JSONB + 迁移兼容） ----------

test('E.1: POST /api/session 写入 sessions（roles JSONB / topic_type / started_at）', async () => {
  const { pool, recorded } = mockPool(() => ({ rows: [{ id: 1, company: '字节跳动' }] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await sessionHandler(
    mockReq({
      company: '字节跳动',
      job_title: '产品经理',
      topic: '题目全文',
      topic_type: 'business_case',
      roles: ['ib_analyst', 'strategy_consultant', 'ops_director'],
      voice_enabled: true,
      camera_enabled: false,
    }),
    res
  );
  assert.equal(res.statusCode, 200);
  const insert = recorded.find((r) => /INSERT INTO sessions/.test(r.sql));
  assert.ok(insert, '未写入 sessions 表');
  assert.ok(/roles/.test(insert!.sql));
  assert.ok(/started_at/.test(insert!.sql));
  // roles 以 JSONB 字符串传入
  const rolesParam = insert!.params.find((p) => typeof p === 'string' && p.includes('ib_analyst'));
  assert.ok(rolesParam, 'roles 未序列化');
  const parsed = JSON.parse(rolesParam as string);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].id, 'ib_analyst');
});

test('D.2 迁移兼容：新列不存在时回退旧 schema（simulation_sessions + ai_personas）', async () => {
  const { pool, recorded } = mockPool((sql) => {
    // v0.8 链路：sessions 的任何一次插入（v08/v071）都因缺列失败 → 最终回退旧表
    if (/INSERT INTO sessions/.test(sql)) {
      throw new Error('column "roles" of relation "sessions" does not exist');
    }
    return { rows: [{ id: 99 }] };
  });
  setPoolForTesting(pool);
  const res = mockRes();
  await sessionHandler(
    mockReq({ company: '腾讯', job_title: '产品经理', topic: '题', roles: ['hr_manager', 'value_investor', 'brand_director'] }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.ok(recorded.some((r) => /INSERT INTO simulation_sessions/.test(r.sql)), '未回退旧表');
  assert.equal(recorded.filter((r) => /INSERT INTO ai_personas/.test(r.sql)).length, 3, 'ai_personas 未写入');
});

test('E.1: PUT /api/session 更新状态（FINISHED 记 ended_at）', async () => {
  const { pool, recorded } = mockPool(() => ({ rows: [{ id: 1, status: 'FINISHED' }] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await sessionHandler({ method: 'PUT', body: { session_id: 1, status: 'FINISHED' }, query: {}, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 200);
  const upd = recorded.find((r) => /UPDATE sessions SET status/.test(r.sql));
  assert.ok(upd);
  assert.ok(/ended_at/.test(upd!.sql));
});

// ---------- D.2：transcripts 字段 ----------

test('D.2: POST /api/message 写入 transcripts（speaker 合并 + 时间戳 + segment id）', async () => {
  const { pool, recorded } = mockPool(() => ({ rows: [{ id: 1 }] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await messageHandler(
    mockReq({
      session_id: 5,
      speaker_type: 'user',
      speaker_id: 'user',
      speaker_name: '陈明',
      message: '我认为应该先调研',
      round: 3,
      start_ms: 120000,
      end_ms: 128000,
      confidence: 0.97,
      stepfun_segment_id: 'seg_001',
    }),
    res
  );
  assert.equal(res.statusCode, 200);
  const ins = recorded.find((r) => /INSERT INTO transcripts/.test(r.sql));
  assert.ok(ins);
  assert.ok(/stepfun_segment_id/.test(ins!.sql));
  assert.equal(ins!.params[1], 'user'); // speaker = 'user'
  assert.ok(ins!.params.includes(120000));
  assert.ok(ins!.params.includes('seg_001'));
});

test('D.2: AI 消息 speaker 取 speaker_id', async () => {
  const { pool, recorded } = mockPool(() => ({ rows: [{ id: 2 }] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await messageHandler(
    mockReq({ session_id: 5, speaker_type: 'ai', speaker_id: 'ib_analyst', speaker_name: '投行分析师', message: '我反对', round: 4 }),
    res
  );
  const ins = recorded.find((r) => /INSERT INTO transcripts/.test(r.sql));
  assert.equal(ins!.params[1], 'ib_analyst');
});

// ---------- 4.1.4：events 批量入库 ----------

test('4.1.4: POST /api/events 批量入库并过滤非法类型', async () => {
  const { pool, recorded } = mockPool(() => ({ rows: [] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await eventsHandler(
    mockReq({
      session_id: 3,
      events: [
        { event_type: 'stage_change', actor: 'system', target: 'FREE_DISCUSSION', timestamp_ms: 120000, metadata: { reason: 'countdown' } },
        { event_type: 'interrupt', actor: 'ib_analyst', target: 'user', timestamp_ms: 130000, metadata: { rule: 'user_over_30s' } },
        { event_type: 'bogus_type', actor: 'x', target: 'y', timestamp_ms: 1 },
      ],
    }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).inserted, 2, '非法事件类型应被过滤');
  const ins = recorded.find((r) => /INSERT INTO events/.test(r.sql));
  assert.ok(ins);
  // 6 个占位符 × 2 行
  assert.equal((ins!.sql.match(/\$\d+/g) ?? []).length, 12);
});

test('4.1.4: GET /api/events?session_id= 按时间排序', async () => {
  const { pool, recorded } = mockPool(() => ({ rows: [{ id: 1, event_type: 'speak_grant' }] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await eventsHandler({ method: 'GET', query: { session_id: '3' }, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 200);
  assert.ok(recorded[0].sql.includes('ORDER BY timestamp_ms ASC'));
});

// ---------- D.2：reports JSONB ----------

test('D.2: POST /api/feedback 写入 reports（dimension_scores/evidence_pool/suggestions JSONB）', async () => {
  const { pool, recorded } = mockPool(() => ({ rows: [{ id: 1 }] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await feedbackHandler(
    mockReq({
      session_id: 8,
      overall_score: 72,
      dimension_scores: { content: { score: 28, max: 40 } },
      evidence_pool: [{ id: 'ev_001', timestamp_ms: 195000, content: '我认为应该先做用户调研' }],
      suggestions: ['下次练习在前 3 分钟发言'],
    }),
    res
  );
  assert.equal(res.statusCode, 200);
  const ins = recorded.find((r) => /INSERT INTO reports/.test(r.sql));
  assert.ok(ins);
  assert.ok(/\$5::jsonb/.test(ins!.sql), 'suggestions 未按 JSONB 写入');
  // params[2] = dimension_scores JSON，params[3] = evidence_pool JSON，params[4] = suggestions JSON
  assert.deepEqual(JSON.parse(ins!.params[2] as string).content.score, 28);
  assert.deepEqual(JSON.parse(ins!.params[3] as string)[0].id, 'ev_001');
  assert.deepEqual(JSON.parse(ins!.params[4] as string), ['下次练习在前 3 分钟发言']);
});

// ---------- 4.1.8 / E.2：形象端点 ----------

test('4.1.8: GET /api/avatars/presets 返回 ≥8 预设与行业清单', async () => {
  const res = mockRes();
  await avatarsHandler({ method: 'GET', query: {}, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.presets.length >= 8);
  assert.ok(data.industries.length >= 4);
  assert.ok(data.presets.every((p: any) => p.asset_url && p.default_voice_id));
});

test('C10: 预设形象不可删除；上传形象可删除', async () => {
  const res1 = mockRes();
  await avatarsHandler({ method: 'DELETE', query: { id: 'visionary_01' }, headers: {}, socket: {} } as any, res1);
  assert.equal(res1.statusCode, 403);

  const { pool, recorded } = mockPool(() => ({ rows: [] }));
  setPoolForTesting(pool);
  const res2 = mockRes();
  await avatarsHandler({ method: 'DELETE', query: { id: 'uploaded_123' }, headers: {}, socket: {} } as any, res2);
  assert.equal(res2.statusCode, 200);
  assert.ok(recorded.some((r) => /DELETE FROM avatars/.test(r.sql)));
});

// ---------- E.2：报告读取与面后分析 ----------

test('E.2: GET /api/sessions/{id}/report 返回报告行', async () => {
  const { pool } = mockPool(() => ({ rows: [{ id: 1, session_id: 8, overall_score: 72 }] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await reportHandler({ method: 'GET', query: { id: '8' }, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).overall_score, 72);
});

test('7.6: POST /api/sessions/{id}/analyze 读 transcripts+events → 规则+LLM → 落库', async () => {
  const { pool, recorded } = mockPool((sql) => {
    if (/SELECT \* FROM sessions/.test(sql)) {
      return { rows: [{ id: 8, topic: '群面题目', started_at: new Date(0), ended_at: new Date(20 * 60 * 1000) }] };
    }
    if (/FROM transcripts/.test(sql)) {
      return {
        rows: [
          { id: 1, speaker: 'user', speaker_name: '陈明', message: '首先我认为应该先做用户调研', created_at: new Date(30_000), start_ms: 30_000, end_ms: 38_000 },
          { id: 2, speaker: 'ib_analyst', speaker_id: 'ib_analyst', speaker_name: '投行分析师', message: '我同意，补充竞品分析', created_at: new Date(45_000) },
        ],
      };
    }
    if (/FROM events/.test(sql)) {
      return { rows: [{ event_type: 'interrupt', actor: 'ib_analyst', target: 'user', timestamp_ms: 40_000, metadata: { rule: 'user_over_30s' } }] };
    }
    return { rows: [] };
  });
  setPoolForTesting(pool);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"structure_score": 88, "response_quality": 80, "stress_response_quality": 75, "conflict_handling": 70, "support_others": 80, "coordinate_others": 72, "evidence": [{"content": "首先调研", "timestamp_ms": 30000}]}' } }],
      }),
      { status: 200 }
    )) as any;
  process.env.DEEPSEEK_API_KEY = 'test-key';

  const res = mockRes();
  await analyzeHandler({ method: 'POST', query: { id: '8' }, headers: {}, socket: {} } as any, res);

  globalThis.fetch = originalFetch;

  assert.equal(res.statusCode, 200);
  const report = JSON.parse(res.body);
  assert.equal(report.session_id, 8);
  assert.equal(report.persisted, true);
  assert.ok(report.dimensions.content.score > 0);
  assert.ok(recorded.some((r) => /INSERT INTO reports/.test(r.sql)), '报告未落库');
});
// ---------- D.4：visual_features 批量入库 ----------

test('D.4: POST /api/sessions/{id}/visual 批量写入 visual_features（6 列参数化）', async () => {
  const { pool, recorded } = mockPool(() => ({ rows: [] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await visualHandler(
    mockReq({
      session_id: 12,
      rows: [
        { timestamp_ms: 1000, eye_contact: 0.75, emotion: 'neutral', head_pose: { pitch: -3.2, yaw: 1.1, roll: 0 }, engagement: 1 },
        { timestamp_ms: 2000, eye_contact: 0.5, emotion: 'nervous', head_pose: { pitch: -20, yaw: 0, roll: 2 }, engagement: 0.5 },
        { timestamp_ms: 3000, eye_contact: 9, emotion: 'bogus', head_pose: null, engagement: -1 }, // 越界/非法值被收敛
      ],
    }, { id: '12' }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).inserted, 3);
  const ins = recorded.find((r) => /INSERT INTO visual_features/.test(r.sql));
  assert.ok(ins, '未写入 visual_features 表');
  // 6 列（含 session_id）× 3 行 = 18 个占位符
  assert.equal((ins!.sql.match(/\$\d+/g) ?? []).length, 18);
  assert.ok(ins!.params.includes(12), 'session_id 未写入');
  assert.ok(ins!.params.includes('nervous'));
  // 越界值收敛：eye_contact 9 → 1、engagement -1 → 0、非法情绪 → neutral、head_pose null → 0 姿态
  assert.ok(ins!.params.includes(1) && ins!.params.includes(0));
  assert.equal(ins!.params.filter((p) => p === 'neutral').length, 2);
});

test('D.4: GET /api/sessions/{id}/visual 按时间排序返回聚合行', async () => {
  const { pool, recorded } = mockPool(() => ({ rows: [{ timestamp_ms: 1000, eye_contact: 0.8, emotion: 'neutral' }] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await visualHandler({ method: 'GET', query: { id: '12' }, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 200);
  assert.ok(recorded[0].sql.includes('ORDER BY timestamp_ms ASC'));
  assert.equal(JSON.parse(res.body)[0].eye_contact, 0.8);
});

test('D.4: POST visual rows 为空 → 400；视觉维度不阻断面试', async () => {
  const { pool } = mockPool(() => ({ rows: [] }));
  setPoolForTesting(pool);
  const res = mockRes();
  await visualHandler(mockReq({ session_id: 12, rows: [] }, { id: '12' }), res);
  assert.equal(res.statusCode, 400);
});

test('7.6: analyze 读 visual_features → 视觉维度 enabled', async () => {
  const { pool, recorded } = mockPool((sql) => {
    if (/SELECT \* FROM sessions/.test(sql)) {
      return { rows: [{ id: 8, topic: '群面题目', started_at: new Date(0), ended_at: new Date(20 * 60 * 1000) }] };
    }
    if (/FROM transcripts/.test(sql)) {
      return { rows: [{ id: 1, speaker: 'user', speaker_name: '陈明', message: '首先我认为应该先做用户调研', created_at: new Date(30_000), start_ms: 30_000, end_ms: 38_000 }] };
    }
    if (/FROM visual_features/.test(sql)) {
      return {
        rows: Array.from({ length: 40 }, (_, i) => ({
          timestamp_ms: i * 1000,
          eye_contact: 0.9,
          emotion: 'neutral',
          head_pose: { pitch: 0, yaw: 0, roll: 0 },
          engagement: 1,
        })),
      };
    }
    return { rows: [] };
  });
  setPoolForTesting(pool);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"structure_score": 88, "response_quality": 80, "stress_response_quality": 75, "conflict_handling": 70, "support_others": 80, "coordinate_others": 72}' } }],
      }),
      { status: 200 }
    )) as any;
  process.env.DEEPSEEK_API_KEY = 'test-key';

  const res = mockRes();
  await analyzeHandler({ method: 'POST', query: { id: '8' }, headers: {}, socket: {} } as any, res);
  globalThis.fetch = originalFetch;

  assert.equal(res.statusCode, 200);
  const report = JSON.parse(res.body);
  assert.ok(recorded.some((r) => /FROM visual_features/.test(r.sql)), '未读取 visual_features');
  assert.equal(report.dimensions.visual.status, 'enabled');
  assert.equal(report.dimensions.visual.max, 100);
  assert.ok(report.dimensions.visual.score > 0);
});

test('7.6: visual_features 表缺失时容忍 → 视觉 not_enabled（不阻断分析）', async () => {
  const { pool } = mockPool((sql) => {
    if (/SELECT \* FROM sessions/.test(sql)) {
      return { rows: [{ id: 8, topic: '题目', started_at: new Date(0), ended_at: new Date(20 * 60 * 1000) }] };
    }
    if (/FROM visual_features/.test(sql)) throw new Error('relation "visual_features" does not exist');
    return { rows: [] };
  });
  setPoolForTesting(pool);

  const res = mockRes();
  await analyzeHandler({ method: 'POST', query: { id: '8' }, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 200);
  const report = JSON.parse(res.body);
  assert.equal(report.dimensions.visual.status, 'not_enabled');
  assert.equal(report.dimensions.visual.score, 0);
});


// ---------- 未配置数据库时 503 不崩溃 ----------

test('DATABASE_URL 缺失时返回 503（本地模式由前端降级）', async () => {
  delete process.env.DATABASE_URL;
  setPoolForTesting(null);
  const res = mockRes();
  await sessionHandler({ method: 'GET', query: {}, headers: {}, socket: {} } as any, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body, /DATABASE_NOT_CONFIGURED/);
});
