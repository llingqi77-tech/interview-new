import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initPhaseEngine,
  tickPhase,
  advancePhaseByKeyword,
  skipAiIntro,
  currentPhase,
  currentOpeningSpeaker,
  defaultOpeningOrder,
  phaseRemainingMs,
  stageUrgency,
  phaseProgress,
  formatCountdown,
  transitionKey,
  INTRO_TURN_MS,
  WARNING_MS,
  FREE_WRAP_MS,
  PANEL_QA_MIN_MS,
  PANEL_QA_MAX_MS,
  COUNTER_ASK_RANGE,
  LGD_PHASES,
  PANEL_PHASES,
  type PhaseConfig,
} from '../engine/phaseEngine.ts';

/** 测试用短时长配置 */
const config: PhaseConfig = {
  durationsMs: { READING: 1000, INTRO: 4000, FREE_DISCUSSION: 10_000, SUMMARY: 2000 },
  openingOrder: ['a1', 'a2', 'user'],
};

test('PRD 5.: 群面四阶段时长（审题3min/自我介绍每人1min共4min/自由讨论15min/总结3min）', () => {
  assert.equal(LGD_PHASES[0].durationMs, 3 * 60 * 1000);
  assert.equal(LGD_PHASES[1].durationMs, 4 * 60 * 1000);
  assert.equal(LGD_PHASES[2].durationMs, 15 * 60 * 1000);
  assert.equal(LGD_PHASES[3].durationMs, 3 * 60 * 1000);
  assert.equal(INTRO_TURN_MS, 60 * 1000);
  assert.equal(WARNING_MS, 60 * 1000);
  assert.equal(FREE_WRAP_MS, 3 * 60 * 1000);
});

test('PRD 6.: 单面三阶段时长（自我介绍1min/问答8-10min/反问2min）', () => {
  assert.equal(PANEL_PHASES[0].durationMs, 60 * 1000);
  assert.ok(PANEL_PHASES[1].durationMs >= PANEL_QA_MIN_MS);
  assert.ok(PANEL_PHASES[1].durationMs <= PANEL_QA_MAX_MS);
  assert.equal(PANEL_PHASES[2].durationMs, 2 * 60 * 1000);
  assert.deepEqual([...COUNTER_ASK_RANGE], [2, 3]);
});

test('TC-01: 倒计时到点自动切换阶段（审题→自我介绍→自由讨论→总结→结束）', () => {
  let state = initPhaseEngine(0, 'lgd', config);
  assert.equal(currentPhase(state, 'lgd', config).id, 'READING');

  let res = tickPhase(state, 500, 'lgd', config, 0);
  assert.equal(res.events.some((e) => e.event_type === 'stage_change'), false);
  assert.equal(currentPhase(res.state, 'lgd', config).id, 'READING');

  res = tickPhase(state, 1000, 'lgd', config, 0);
  assert.equal(res.changed, true);
  assert.equal(currentPhase(res.state, 'lgd', config).id, 'INTRO');
  assert.equal(res.events[0].event_type, 'stage_change');
  assert.equal(res.events[0].metadata?.reason, 'countdown');
  assert.equal(res.events[0].metadata?.beep, true);
  state = res.state;

  assert.equal(currentOpeningSpeaker(state, config, 'lgd'), 'a1');
  res = tickPhase(state, 1000 + INTRO_TURN_MS + 1, 'lgd', config, 0);
  assert.equal(currentOpeningSpeaker(res.state, config, 'lgd'), 'a2');
  assert.equal(res.events[0].event_type, 'speak_grant');
  state = res.state;

  res = tickPhase(state, 1000 + 2 * INTRO_TURN_MS + 1, 'lgd', config, 0);
  assert.equal(currentOpeningSpeaker(res.state, config, 'lgd'), 'user');
  state = res.state;

  res = tickPhase(state, 1000 + 3 * INTRO_TURN_MS + 1, 'lgd', config, 0);
  assert.equal(currentPhase(res.state, 'lgd', config).id, 'FREE_DISCUSSION');
  state = res.state;

  res = tickPhase(state, 1000 + 3 * INTRO_TURN_MS + 1 + 10_000, 'lgd', config, 0);
  assert.equal(currentPhase(res.state, 'lgd', config).id, 'SUMMARY');
  state = res.state;

  res = tickPhase(state, 1000 + 3 * INTRO_TURN_MS + 1 + 10_000 + 2000, 'lgd', config, 0);
  assert.equal(res.state.finished, true);
  assert.equal(res.events[0].target, 'FINISHED');
});

test('TC-01: 与关键词检测冲突时以倒计时为准', () => {
  const state = initPhaseEngine(0, 'lgd', config);
  const res = tickPhase(state, 100, 'lgd', config, 0);
  assert.equal(res.events.some((e) => e.event_type === 'stage_change'), false);
  assert.equal(currentPhase(res.state, 'lgd', config).id, 'READING');
  const keyword = advancePhaseByKeyword(state, 100, 'lgd', config, 0);
  assert.equal(keyword.changed, false);
});

test('关键词兜底：自由讨论中可提前进入总结', () => {
  const state = { ...initPhaseEngine(0, 'lgd', config), phaseIndex: 2, phaseStartedAt: 0 };
  const res = advancePhaseByKeyword(state, 1000, 'lgd', config, 0);
  assert.equal(res.changed, true);
  assert.equal(currentPhase(res.state, 'lgd', config).id, 'SUMMARY');
  assert.equal(res.events[0].metadata?.reason, 'keyword');
});

test('一键跳过 AI 自我介绍：直接进入自由讨论', () => {
  const state = { ...initPhaseEngine(0, 'lgd', config), phaseIndex: 1, phaseStartedAt: 0, openingIndex: 1 };
  const res = skipAiIntro(state, 30_000, 'lgd', config, 0);
  assert.equal(res.changed, true);
  assert.equal(currentPhase(res.state, 'lgd', config).id, 'FREE_DISCUSSION');
  assert.equal(res.events[0].metadata?.reason, 'skip_ai_intro');
});

test('默认真人先做自我介绍', () => {
  assert.deepEqual(defaultOpeningOrder(['c1', 'c2', 'c3']), ['user', 'c1', 'c2', 'c3']);
});

test('阶段结束前 1 分钟提醒 + 自由讨论最后 3 分钟收尾提示', () => {
  const cfg: PhaseConfig = { durationsMs: { READING: 180_000, FREE_DISCUSSION: 900_000 } };
  const reading = initPhaseEngine(0, 'lgd', cfg);
  const warn = tickPhase(reading, 125_000, 'lgd', cfg, 0);
  const ev = warn.events.find((e) => e.event_type === 'time_warning');
  assert.ok(ev);
  assert.equal(ev.metadata?.remainingMs, 55_000);

  const free = { ...initPhaseEngine(0, 'lgd', cfg), phaseIndex: 2, phaseStartedAt: 0 };
  const wrap = tickPhase(free, 900_000 - FREE_WRAP_MS, 'lgd', cfg, 0);
  assert.ok(wrap.events.some((e) => e.event_type === 'wrap_up'));
});

test('阶段紧急度与进度', () => {
  const state = { ...initPhaseEngine(0, 'lgd'), phaseIndex: 2, phaseStartedAt: 0 };
  assert.equal(stageUrgency(state, 0, 'lgd'), 0);
  assert.ok(stageUrgency(state, 15 * 60 * 1000 - 10_000, 'lgd') > 0.9);
  const cfg: PhaseConfig = { durationsMs: { FREE_DISCUSSION: 10_000 } };
  const s2 = { ...initPhaseEngine(0, 'lgd', cfg), phaseIndex: 2, phaseStartedAt: 0 };
  assert.equal(phaseProgress(s2, 5000, 'lgd', cfg), 0.5);
  assert.equal(phaseRemainingMs(s2, 5000, 'lgd', cfg), 5000);
});

test('倒计时格式化', () => {
  assert.equal(formatCountdown(0), '00:00');
  assert.equal(formatCountdown(65_000), '01:05');
  assert.equal(formatCountdown(2 * 60 * 1000), '02:00');
});

test('结束后不再推进', () => {
  const state = { ...initPhaseEngine(0, 'lgd', config), finished: true };
  const res = tickPhase(state, 999_999, 'lgd', config, 0);
  assert.equal(res.changed, false);
  assert.equal(res.state.finished, true);
});

test('阶段切换引导语 key 映射', () => {
  assert.equal(transitionKey('lgd', 'OPEN', 'READING'), 'open->reading');
  assert.equal(transitionKey('lgd', 'READING', 'INTRO'), 'reading->intro');
  assert.equal(transitionKey('lgd', 'INTRO', 'FREE_DISCUSSION'), 'intro->free');
  assert.equal(transitionKey('lgd', 'FREE_DISCUSSION', 'SUMMARY'), 'free->summary');
  assert.equal(transitionKey('lgd', 'SUMMARY', 'FINISHED'), 'summary->end');
  assert.equal(transitionKey('panel', 'OPEN', 'SELF_INTRO'), 'open->intro');
  assert.equal(transitionKey('panel', 'SELF_INTRO', 'QA'), 'intro->qa');
  assert.equal(transitionKey('panel', 'QA', 'COUNTER_ASK'), 'qa->counter');
  assert.equal(transitionKey('panel', 'COUNTER_ASK', 'FINISHED'), 'counter->end');
});
