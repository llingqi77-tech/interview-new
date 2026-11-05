import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/llm.ts';

/**
 * /api/llm 代理集成测试（mock DeepSeek fetch，验证 M0 代理 + SSE 透传 + 限流）
 */

const originalFetch = globalThis.fetch;

function mockReq(body: unknown, ip = '10.0.0.1') {
  return {
    method: 'POST',
    body,
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
  } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 0,
    headers: {},
    body: '',
    ended: false,
    writeHead(status: number, headers: Record<string, string>) {
      res.statusCode = status;
      res.headers = headers;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = JSON.stringify(data);
      res.ended = true;
      return res;
    },
    write(chunk: string) {
      res.body += chunk;
      return true;
    },
    end() {
      res.ended = true;
    },
    on() {},
  };
  return res;
}

function jsonRes(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function sseRes(lines: string[]) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const l of lines) controller.enqueue(encoder.encode(l));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** pi-ai 的 openai-completions 恒走流式：上游 mock 需 SSE 形态且以 finish_reason 收尾 */
function llmSse(chunks: string[]) {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return sseRes([
    ...chunks.map((c) => `data: {"choices":[{"delta":{"content":"${esc(c)}"},"finish_reason":null}]}\n\n`),
    `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n`,
    'data: [DONE]\n\n',
  ]);
}

/** 解析 SSE 写入内容为事件列表 */
function parseSse(body: string): { event: string; data: any }[] {
  return body
    .split('\n\n')
    .filter((b) => b.trim())
    .map((block) => {
      const event = block.match(/event: (.+)/)?.[1] ?? 'message';
      const data = block.match(/data: (.+)/)?.[1] ?? '';
      return { event, data: JSON.parse(data) };
    });
}

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = 'test-key';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('/api/llm topic：按模式和题型构建上游提问', async () => {
  let prompt = '';
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    prompt = JSON.stringify(JSON.parse(String(init.body)).messages);
    return llmSse(['准备内容']);
  }) as any;
  const panel = mockRes();
  await handler(mockReq({ action: 'topic', payload: { company: '测试公司', jobTitle: '产品经理', format: 'panel' } }), panel);
  assert.equal(panel.statusCode, 200);
  assert.match(prompt, /结构化单面提纲/);
  assert.doesNotMatch(prompt, /本次题型要求/);
  const lgd = mockRes();
  await handler(mockReq({ action: 'topic', payload: { company: '测试公司', jobTitle: '产品经理', format: 'lgd', topicType: 'resource_competition' } }), lgd);
  assert.equal(lgd.statusCode, 200);
  assert.match(prompt, /资源争夺题/);
});

test('/api/llm topic：非流式生成并清理 Markdown', async () => {
  globalThis.fetch = (async () => llmSse(['**一、背景**\n测试题目'])) as any;
  const res = mockRes();
  await handler(mockReq({ action: 'topic', payload: { company: '字节跳动', jobTitle: '产品经理' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.includes('**'), false);
});

test('/api/llm reply：语音版 JSON 输出解析（content/emotion/instruction）', async () => {
  globalThis.fetch = (async () =>
    llmSse(['{"content": "我认为应该先做调研", "emotion": "serious", "target": "user", "stepfun_tts_instruction": "语速稍慢"}'])) as any;
  const res = mockRes();
  await handler(
    mockReq({
      action: 'reply',
      payload: { card: { id: 'ib_analyst' }, topic: '题', jobTitle: '产品经理', history: [], phase: '开局框架阶段', voiceMode: true },
    }),
    res
  );
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.content, '我认为应该先做调研');
  assert.equal(data.emotion, 'serious');
  assert.equal(data.stepfun_tts_instruction, '语速稍慢');
});

test('/api/llm reply 流式：SSE delta 渐进 + done 元数据', async () => {
  globalThis.fetch = (async () => llmSse(['{"content": "大家好，我', '认为先调研", "emotion": "neutral"}'])) as any;
  const res = mockRes();
  await handler(
    mockReq({
      action: 'reply',
      payload: { card: { id: 'strategy_consultant' }, topic: '题', jobTitle: '产品经理', history: [], phase: '深入讨论与方案贡献' },
      stream: true,
    }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/event-stream/);
  const events = parseSse(res.body);
  const deltas = events.filter((e) => e.event === 'delta').map((e) => e.data.delta).join('');
  assert.equal(deltas, '大家好，我认为先调研');
  const done = events.find((e) => e.event === 'done');
  assert.ok(done);
  assert.equal(done!.data.content, '大家好，我认为先调研');
  assert.equal(done!.data.emotion, 'neutral');
});

test('/api/llm reply：未知角色卡 id → 400', async () => {
  const res = mockRes();
  await handler(mockReq({ action: 'reply', payload: { card: { id: 'not_exist' }, topic: '题', jobTitle: '岗', history: [], phase: '开局框架阶段' } }), res);
  assert.equal(res.statusCode, 400);
});

test('/api/llm analyze：规则引擎 + LLM 语义分合并', async () => {
  globalThis.fetch = (async () =>
    jsonRes({
      choices: [
        {
          message: {
            content: '{"structure_score": 90, "response_quality": 80, "stress_response_quality": 70, "conflict_handling": 75, "support_others": 80, "coordinate_others": 70, "evidence": [{"content": "我认为先调研", "timestamp_ms": 30000}]}',
          },
        },
      ],
    })) as any;
  const res = mockRes();
  await handler(
    mockReq({
      action: 'analyze',
      payload: {
        topic: '题',
        jobTitle: '产品经理',
        session_id: 1,
        sessionStartAt: 0,
        durationMs: 600_000,
        messages: [
          { id: '1', senderId: 'user', senderName: '陈明', content: '首先我认为应该先做用户调研', timestamp: 30_000, type: 'message', startMs: 30_000, endMs: 38_000 },
          { id: '2', senderId: 'ai1', senderName: '张强', content: '我同意，补充竞品分析', timestamp: 45_000, type: 'message', startMs: 45_000, endMs: 49_000 },
        ],
        events: [{ event_type: 'interrupt', actor: 'ai1', target: 'user', timestamp_ms: 40_000, metadata: { rule: 'user_over_30s' } }],
      },
    }),
    res
  );
  assert.equal(res.statusCode, 200);
  const report = JSON.parse(res.body);
  assert.equal(report.session_id, 1);
  assert.ok(report.overall_score > 0);
  assert.equal(report.dimensions.content.max, 100);
  assert.ok(report.dimensions.content.evidence.length > 0);
});

test('/api/llm 限流：同 IP 超频 → 429（Q-N2）', async () => {
  globalThis.fetch = (async () => llmSse(['{}'])) as any;
  let last: any;
  for (let i = 0; i < 61; i++) {
    const res = mockRes();
    await handler(mockReq({ action: 'feedback', payload: { topic: 't', jobTitle: 'j', history: [] } }, '192.168.1.100'), res);
    last = res;
  }
  assert.equal(last.statusCode, 429);
  assert.match(last.body, /rate_limited/);
});

test('/api/llm 未配置 key → 500 LLM_NOT_CONFIGURED', async () => {
  delete process.env.DEEPSEEK_API_KEY;
  const res = mockRes();
  await handler(mockReq({ action: 'topic', payload: { company: 'a', jobTitle: 'b' } }, '172.16.0.9'), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body, /LLM_NOT_CONFIGURED/);
});

test('按 action 模型路由：DEEPSEEK_MODEL_REPLY 覆盖 reply，topic 用 DEEPSEEK_MODEL', async () => {
  const prevModel = process.env.DEEPSEEK_MODEL;
  const prevReply = process.env.DEEPSEEK_MODEL_REPLY;
  process.env.DEEPSEEK_MODEL = 'step-5-preview';
  process.env.DEEPSEEK_MODEL_REPLY = 'step-3.7-flash';

  const seen: string[] = [];
  globalThis.fetch = (async (_url: string, init: any) => {
    const body = JSON.parse(String(init.body));
    seen.push(body.model);
    return llmSse(['{"content":"好的","emotion":"neutral"}']);
  }) as any;

  try {
    let res = mockRes();
    await handler(mockReq({ action: 'reply', payload: { card: { id: 'strategy_consultant' }, topic: 't', jobTitle: 'j', history: [] } }), res);
    assert.equal(res.statusCode, 200);

    res = mockRes();
    await handler(mockReq({ action: 'topic', payload: { company: '字节', jobTitle: '产品' } }), res);
    assert.equal(res.statusCode, 200);

    assert.deepEqual(seen, ['step-3.7-flash', 'step-5-preview'], `模型路由错误: ${JSON.stringify(seen)}`);
  } finally {
    if (prevModel === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = prevModel;
    if (prevReply === undefined) delete process.env.DEEPSEEK_MODEL_REPLY;
    else process.env.DEEPSEEK_MODEL_REPLY = prevReply;
  }
});
