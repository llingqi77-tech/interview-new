import type { InterviewFormat, Message } from '../types.ts';

/**
 * 阶段切换引导语（PRD 4. 阶段切换与引导语）
 *
 * 结构固定：宣布上一阶段结束 → 说明下一阶段目标、时长与要求 → 指定发言人或交出发言权。
 * 文本是固定的，由 TTS 直接播报，同时以字幕气泡展示。
 */

export type ScriptTransition =
  | 'open->reading' | 'reading->intro' | 'intro->free' | 'free->wrap' | 'free->summary' | 'summary->end'
  | 'open->intro' | 'intro->qa' | 'qa->rotate' | 'qa->counter' | 'counter->end';

/** 无领导小组讨论 · 主持面试官引导语（PRD 原文） */
export const LGD_SCRIPTS: Record<string, string> = {
  'open->reading':
    '大家好，我是本场的主持面试官，今天的讨论题目已呈现在屏幕上，本场面试共有审题、自我介绍、自由讨论、总结陈词四个阶段。首先进入审题环节，计时3分钟，请大家先阅读题目，暂时不要发言。',
  'reading->intro': '审题时间到。接下来是自我介绍环节，每人 1 分钟，请先由你开始。',
  'intro->free': '下面进入自由讨论，共 15 分钟。注意不要超时',
  'free->wrap': '讨论还剩 3 分钟，请大家围绕结论达成一致，为后面的总结做准备。',
  'free->summary': '讨论时间到，下面开始你们小组的汇报',
  'summary->end': '时间到，本场面试到此结束。面试报告稍后生成',
};

/** 结构化单面 · 主面试官引导语（PRD 原文） */
export const PANEL_SCRIPTS: Record<string, string> = {
  'open->intro':
    '你好，我是本场的主面试官。面试分为自我介绍、面试官提问、候选人反问三个阶段，大约 15分钟。先请你做 1 分钟自我介绍。',
  'intro->qa': '接下来进入提问环节，我和另外一位面试官会轮流提问，大约 8 到 10 分钟',
  'qa->rotate': '专业和经历的部分先聊到这里，接下来交由另一位面试官继续提问',
  'qa->counter': '提问环节结束。接下来是反问环节，时间 2 分钟，你可以向我们提 2 到 3 个问题。',
  'counter->end': '时间到，本场面试结束，感谢你的参与。正在为你生成评估报告，请稍候。',
};

export function scriptFor(format: InterviewFormat, transition: string): string {
  const table = format === 'panel' ? PANEL_SCRIPTS : LGD_SCRIPTS;
  const text = table[transition];
  if (!text) throw new Error(`未知引导语: ${format}/${transition}`);
  return text;
}

/** 引导语三段式拆解（用于校验与 UI 高亮） */
export interface ScriptStructure {
  /** 宣布上一阶段结束 */
  closing: string;
  /** 说明下一阶段目标、时长与要求 */
  next: string;
  /** 指定发言人或交出发言权 */
  handoff: string;
}

const HANDOFF_MARKERS = ['请先由你', '请大家', '下面开始', '交由', '你可以向我们', '先请你', '请先阅读'];

export function scriptStructure(format: InterviewFormat, transition: string): ScriptStructure {
  const text = scriptFor(format, transition);
  const sentences = text
    .split(/(?<=[。！？])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const handoffIndex = sentences.findIndex((s) => HANDOFF_MARKERS.some((m) => s.includes(m)));
  const closing = sentences[0] ?? text;
  const handoff = handoffIndex >= 0 ? sentences[handoffIndex] : sentences[sentences.length - 1];
  const next = sentences.slice(1, handoffIndex > 1 ? handoffIndex : undefined).join('') || sentences[1] || closing;
  return { closing, next, handoff };
}

/**
 * 打断或提前完成环节时的一句话确认（PRD：不重复长篇说明，直接切入下一阶段）。
 */
const SHORT_CONFIRM: Record<string, string> = {
  'open->reading': '好，我们开始审题。',
  'reading->intro': '好，我们进入自我介绍。',
  'intro->free': '好，进入自由讨论。',
  'free->wrap': '好，我们开始收尾。',
  'free->summary': '好，开始总结陈词。',
  'summary->end': '好，本场到此结束。',
  'open->intro': '好，请开始自我介绍。',
  'intro->qa': '好，进入提问环节。',
  'qa->rotate': '好，换另一位面试官。',
  'qa->counter': '好，进入反问环节。',
  'counter->end': '好，本场到此结束。',
};

export function shortConfirm(format: InterviewFormat, transition: string): string {
  const line = SHORT_CONFIRM[transition];
  if (!line) throw new Error(`未知确认语: ${format}/${transition}`);
  return line;
}

/** 引导语 → 字幕气泡消息（type=system，source=llm 表示由 AI 播报） */
export function scriptToMessage(input: {
  format: InterviewFormat;
  transition: string;
  atMs: number;
  speakerName: string;
  speakerId?: string;
  short?: boolean;
}): Message {
  const content = input.short
    ? shortConfirm(input.format, input.transition)
    : scriptFor(input.format, input.transition);
  return {
    id: `script-${input.transition}-${input.atMs}`,
    senderId: input.speakerId ?? 'host',
    senderName: input.speakerName,
    content,
    timestamp: Date.now(),
    type: 'system',
    startMs: input.atMs,
    endMs: input.atMs + Math.max(2000, content.length * 180),
    source: 'llm',
    emotion: 'neutral',
  };
}
