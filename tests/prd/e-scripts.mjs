import assert from 'node:assert/strict';
import { load, need } from './_helpers.mjs';

const area = 'scripts';

const LGD = {
  'open->reading': '大家好，我是本场的主持面试官，今天的讨论题目已呈现在屏幕上，本场面试共有审题、自我介绍、自由讨论、总结陈词四个阶段。首先进入审题环节，计时3分钟，请大家先阅读题目，暂时不要发言。',
  'reading->intro': '审题时间到。接下来是自我介绍环节，每人 1 分钟，请先由你开始。',
  'intro->free': '下面进入自由讨论，共 15 分钟。注意不要超时',
  'free->wrap': '讨论还剩 3 分钟，请大家围绕结论达成一致，为后面的总结做准备。',
  'free->summary': '讨论时间到，下面开始你们小组的汇报',
  'summary->end': '时间到，本场面试到此结束。面试报告稍后生成',
};

const PANEL = {
  'open->intro': '你好，我是本场的主面试官。面试分为自我介绍、面试官提问、候选人反问三个阶段，大约 15分钟。先请你做 1 分钟自我介绍。',
  'intro->qa': '接下来进入提问环节，我和另外一位面试官会轮流提问，大约 8 到 10 分钟',
  'qa->rotate': '专业和经历的部分先聊到这里，接下来交由另一位面试官继续提问',
  'qa->counter': '提问环节结束。接下来是反问环节，时间 2 分钟，你可以向我们提 2 到 3 个问题。',
  'counter->end': '时间到，本场面试结束，感谢你的参与。正在为你生成评估报告，请稍候。',
};

const scriptChecks = (format, table, prefix, offset = 0) =>
  Object.entries(table).map(([transition, text], i) => ({
    id: `${prefix}${i + 1 + offset}`, area,
    title: `${format === 'lgd' ? '群面' : '单面'}引导语 ${transition}`,
    async run() {
      const m = await load('engine/phaseScripts.ts');
      need(m, 'scriptFor');
      const actual = m.scriptFor(format, transition);
      assert.equal(actual, text);
    },
  }));

export const checks = [
  ...scriptChecks('lgd', LGD, 'E'),
  ...scriptChecks('panel', PANEL, 'E', 6),
  {
    id: 'E12', area, title: '引导语由 TTS 播报并以字幕气泡展示',
    async run() {
      const m = await load('engine/phaseScripts.ts');
      need(m, 'scriptToMessage');
      const msg = m.scriptToMessage({ format: 'lgd', transition: 'reading->intro', atMs: 1234, speakerName: '陈锋' });
      assert.equal(msg.type, 'system');
      assert.equal(msg.senderName, '陈锋');
      assert.equal(msg.startMs, 1234);
      assert.ok(msg.content.includes('审题时间到'));
      assert.equal(msg.source, 'llm');
    },
  },
  {
    id: 'E13', area, title: '阶段结束前 1 分钟给出时间提醒',
    async run() {
      const p = await load('engine/phaseEngine.ts');
      need(p, 'WARNING_MS', 'tickPhase');
      assert.equal(p.WARNING_MS, 60000);
      const cfg = { durationsMs: { READING: 180000 } };
      const s0 = p.initPhaseEngine(0, 'lgd', cfg);
      const r = p.tickPhase(s0, 125000, 'lgd', cfg, 0);
      const warn = r.events.find((e) => e.event_type === 'time_warning');
      assert.ok(warn, '未产生 time_warning 事件');
      assert.equal(warn.metadata.remainingMs, 55000);
    },
  },
  {
    id: 'E14', area, title: '打断或提前完成环节时，一句话确认后直接切入下一阶段',
    async run() {
      const m = await load('engine/phaseScripts.ts');
      need(m, 'shortConfirm');
      const line = m.shortConfirm('lgd', 'intro->free');
      assert.ok(line.length <= 24, `确认语过长: ${line}`);
      assert.ok(line.includes('自由讨论'), '确认语未点明下一阶段');
    },
  },
  {
    id: 'E15', area, title: '引导语结构：宣布上一阶段结束 → 说明下一阶段目标时长要求 → 指定发言人/交出发言权',
    async run() {
      const m = await load('engine/phaseScripts.ts');
      need(m, 'scriptStructure');
      const s = m.scriptStructure('lgd', 'reading->intro');
      assert.ok(s.closing && s.closing.length > 0, '缺少上一阶段结束语');
      assert.ok(s.next && s.next.length > 0, '缺少下一阶段说明');
      assert.ok(s.handoff && s.handoff.length > 0, '缺少交出发言权');
    },
  },
];
