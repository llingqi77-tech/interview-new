import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplyContentSplitter, buildReplyPayload, cleanTopicText, readPayload, resolveReplyCard, voiceShareOf } from '../api/_lib/llmRoute.ts';
import { HOST_CARD } from '../data/interviewerCards.ts';
import { ROLE_CARDS } from '../data/roleCards.ts';

const card = ROLE_CARDS.find((item) => item.id === 'ib_analyst')!;

test('readPayload：缺 payload、数组、空对象都有明确结果', () => {
  assert.equal(readPayload(undefined), null);
  assert.equal(readPayload([]), null);
  assert.deepEqual(readPayload({}), {});
});

test('cleanTopicText：去掉 markdown 标记并裁掉空白', () => {
  assert.equal(cleanTopicText('  # 题目 *甲* `乙` > 丙  '), '题目 甲 乙  丙');
});

test('resolveReplyCard：主持卡单独解析，未知 id 返回 null', () => {
  assert.equal(resolveReplyCard({ card: { id: HOST_CARD.id } })?.id, HOST_CARD.id);
  assert.equal(resolveReplyCard({ card: { id: card.id } })?.id, card.id);
  assert.equal(resolveReplyCard({}), null);
  assert.equal(resolveReplyCard({ card: { id: 'missing' } }), null);
});

test('buildReplyPayload：缺字段落到默认值，非法数字不当成计数', () => {
  const reply = buildReplyPayload({ speakerKind: 'nope', keyPointDiscussionCount: Number.NaN, history: 'bad' }, card);
  assert.equal(reply.speakerKind, 'candidate');
  assert.equal(reply.keyPointDiscussionCount, 0);
  assert.deepEqual(reply.history, []);
  assert.equal(reply.phase, '开局框架阶段');
  assert.equal(reply.currentKeyPoint, null);
});

test('voiceShareOf：空历史是 0，不除零', () => {
  assert.equal(voiceShareOf([]), 0);
  assert.equal(voiceShareOf([{ senderId: 'user', senderName: '陈明', content: 'a' }, { senderId: 'ai', senderName: '李', content: 'b' }]), 50);
});

test('ReplyContentSplitter：JSON 只吐 content，纯文本整段转发', () => {
  const json = new ReplyContentSplitter();
  assert.equal(json.push('{"content":"你好'), '你好');
  assert.equal(json.push('世界"}'), '世界');
  assert.equal(json.flushTail(), '');

  const raw = new ReplyContentSplitter();
  assert.equal(raw.push('  纯文本'), '  纯文本');
  assert.equal(raw.push('后续'), '后续');
});
