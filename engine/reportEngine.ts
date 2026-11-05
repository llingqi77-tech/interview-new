import type {
  DimensionResult,
  Evidence,
  GameEvent,
  InterviewFormat,
  InterviewReport,
  Message,
  VisualStats,
} from '../types.ts';
import {
  clampScore,
  computeOverall,
  dimensionOrder,
  excludedDimensions,
  scoreBand,
  weightsFor,
  type DimensionId,
  type WeightMap,
} from './scoring.ts';
import { CORE_FOCUS } from './reportCopy.ts';
import { SUMMARY_BONUS } from './summaryIntent.ts';

/**
 * 面后报告引擎（PRD 7. / 8.）
 *
 * 规则引擎实算指标（话语权、发言频次、打断、回应、结构标记、STAR 要素…）
 * + AI 语义分析（0-100 子分，由 /api/analyze 注入）
 * + 证据池（原话 + 时间戳 + 消息序号，报告里可点击定位）
 *
 * 群面 8 维 / 单面 9 维，权重见 engine/scoring.ts。
 */

export type { DimensionResult, InterviewReport };
/** 兼容旧命名（证书 / 链上哈希 / 反馈接口只读 overall_score 与 dimensions） */
export type ReportV15 = InterviewReport;

export interface RuleMetrics {
  userMessageCount: number;
  totalMessageCount: number;
  userSpeakMs: number;
  totalSpeakMs: number;
  voiceShareByTime: number;
  voiceShareByCount: number;
  fillerCount: number;
  fillerRatio: number;
  speakingRateWpm: number;
  interruptedCount: number;
  interruptRecoveryMs: number | null;
  responseCount: number;
  pushDiscussionCount: number;
  structureMarkerCount: number;
  questionCount: number;
  inviteCount: number;
  consensusCount: number;
  star: { situation: boolean; task: boolean; action: boolean; result: boolean };
  starCount: number;
  timeDistribution: { bucketStartMs: number; userChars: number }[];
}

const FILLER_WORDS = ['嗯', '啊', '呃', '那个', '就是', '然后', '这个', '怎么说'];
const RESPONSE_MARKERS = ['同意', '赞同', '补充', '质疑', '回应', '反对', '认可', '支持', '你说得对', '我理解'];
const PUSH_MARKERS = ['首先', '第一', '第二', '第三', '框架', '建议', '总结', '应该', '接下来', '角度', '我提议'];
const STRUCTURE_MARKERS = ['首先', '其次', '最后', '第一', '第二', '第三', '综上', '方面', '要点', '一方面', '另一方面'];
const INVITE_MARKERS = ['你怎么看', '你觉得', '请', '想听听', '有没有补充', '大家'];
const CONSENSUS_MARKERS = ['达成一致', '共识', '就按这个', '我们统一', '折中', '各让一步'];
const STAR_MARKERS = {
  situation: ['当时', '背景', '那段时间', '项目初期', '在…的时候', '场景'],
  task: ['目标', '任务', '负责', '要求', '需要我', '指标'],
  action: ['我做了', '我负责', '我推动', '我设计', '我协调', '具体做法', '于是'],
  result: ['结果', '最终', '提升了', '降低了', '增长了', '%', '数据', '复盘'],
};

function countMarkers(text: string, markers: string[]): number {
  let n = 0;
  for (const m of markers) {
    let idx = text.indexOf(m);
    while (idx !== -1) {
      n += 1;
      idx = text.indexOf(m, idx + m.length);
    }
  }
  return n;
}

function speakMsOf(msg: Message): number {
  if (typeof msg.startMs === 'number' && typeof msg.endMs === 'number' && msg.endMs > msg.startMs) {
    return msg.endMs - msg.startMs;
  }
  return Math.max(800, msg.content.length * 180);
}

export function computeRuleMetrics(
  transcripts: Message[],
  events: GameEvent[],
  sessionStartAt: number
): RuleMetrics {
  const spoken = transcripts.filter((m) => m.type === 'message' && m.content.trim().length > 0);
  const userMsgs = spoken.filter((m) => m.senderId === 'user');
  const userSpeakMs = userMsgs.reduce((acc, m) => acc + speakMsOf(m), 0);
  const totalSpeakMs = spoken.reduce((acc, m) => acc + speakMsOf(m), 0);
  const userText = userMsgs.map((m) => m.content).join('\n');

  const fillerCount = userMsgs.reduce((acc, m) => acc + countMarkers(m.content, FILLER_WORDS), 0);
  const userChars = userText.replace(/\s/g, '').length;
  const speakingRateWpm = userSpeakMs > 0 ? Math.round((userChars / userSpeakMs) * 60000) : 0;

  const interrupts = events.filter((e) => e.event_type === 'interrupt' && e.target === 'user');
  const interruptedCount = interrupts.length;
  let interruptRecoveryMs: number | null = null;
  if (interruptedCount > 0) {
    const gaps: number[] = [];
    for (const ev of interrupts) {
      const next = userMsgs.find((m) => (m.startMs ?? m.timestamp) >= ev.timestamp_ms);
      if (next) gaps.push((next.startMs ?? next.timestamp) - ev.timestamp_ms);
    }
    interruptRecoveryMs = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
  }

  const star = {
    situation: STAR_MARKERS.situation.some((k) => userText.includes(k)),
    task: STAR_MARKERS.task.some((k) => userText.includes(k)),
    action: STAR_MARKERS.action.some((k) => userText.includes(k)),
    result: STAR_MARKERS.result.some((k) => userText.includes(k)),
  };

  const buckets = new Map<number, number>();
  for (const m of userMsgs) {
    const rel = (m.startMs ?? m.timestamp) - sessionStartAt;
    const bucket = Math.max(0, Math.floor(rel / (5 * 60 * 1000))) * 5 * 60 * 1000;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + m.content.length);
  }

  return {
    userMessageCount: userMsgs.length,
    totalMessageCount: spoken.length,
    userSpeakMs,
    totalSpeakMs,
    voiceShareByTime: totalSpeakMs > 0 ? Math.round((userSpeakMs / totalSpeakMs) * 100) : 0,
    voiceShareByCount: spoken.length > 0 ? Math.round((userMsgs.length / spoken.length) * 100) : 0,
    fillerCount,
    fillerRatio: userChars > 0 ? Math.round((fillerCount / userChars) * 1000) / 10 : 0,
    speakingRateWpm,
    interruptedCount,
    interruptRecoveryMs,
    responseCount: userMsgs.reduce((acc, m) => acc + countMarkers(m.content, RESPONSE_MARKERS), 0),
    pushDiscussionCount: userMsgs.reduce((acc, m) => acc + countMarkers(m.content, PUSH_MARKERS), 0),
    structureMarkerCount: userMsgs.reduce((acc, m) => acc + countMarkers(m.content, STRUCTURE_MARKERS), 0),
    questionCount: userMsgs.reduce((acc, m) => acc + (m.content.match(/[？?]/g)?.length ?? 0), 0),
    inviteCount: userMsgs.reduce((acc, m) => acc + countMarkers(m.content, INVITE_MARKERS), 0),
    consensusCount: userMsgs.reduce((acc, m) => acc + countMarkers(m.content, CONSENSUS_MARKERS), 0),
    star,
    starCount: Object.values(star).filter(Boolean).length,
    timeDistribution: [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bucketStartMs, chars]) => ({ bucketStartMs, userChars: chars })),
  };
}

/** 阈值映射：value 达到 full 得 100，低到 empty 得 0 */
export function thresholdScore(value: number, full: number, empty: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= full) return 100;
  if (value <= empty) return 0;
  return Math.round(((value - empty) / (full - empty)) * 100);
}

// ============================================================
// 维度打分：规则引擎实算 + AI 语义分析
// ============================================================

export type SemanticScores = Partial<Record<DimensionId, number>>;

export interface ReportInput {
  format: InterviewFormat;
  transcripts: Message[];
  events: GameEvent[];
  sessionStartAt: number;
  durationMs: number;
  /** AI 语义分析子分（0-100） */
  semantic?: SemanticScores;
  /** 摄像头是否开启且数据充足 */
  visualEnabled?: boolean;
  visualStats?: VisualStats;
  /** 权重覆盖（岗位族 / 职级） */
  jobFamily?: string;
  level?: string;
  weights?: WeightMap;
  /** 真人是否主动争取了总结 */
  summaryByUser?: boolean;
  sessionId?: number | null;
}

/** 规则分与语义分融合：有语义分时各占一半，否则纯规则 */
function blend(rule: number, semantic: number | undefined): number {
  if (typeof semantic === 'number' && Number.isFinite(semantic)) {
    return clampScore(rule * 0.5 + clampScore(semantic) * 0.5);
  }
  return clampScore(rule);
}

function evidenceFrom(
  transcripts: Message[],
  dimension: DimensionId,
  markers: string[],
  limit = 2
): Evidence[] {
  const out: Evidence[] = [];
  transcripts.forEach((m, index) => {
    if (m.senderId !== 'user' || m.type !== 'message') return;
    if (out.length >= limit) return;
    if (!markers.some((k) => m.content.includes(k))) return;
    out.push({
      id: `ev-${dimension}-${index}`,
      modality: 'text',
      timestamp_ms: m.startMs ?? m.timestamp,
      content: m.content.slice(0, 80),
      dimension_hint: dimensionHint(dimension),
      message_index: index,
    });
  });
  return out;
}

function dimensionHint(dimension: DimensionId): Evidence['dimension_hint'] {
  if (dimension === 'visual' || dimension === 'voiceVisual') return 'visual';
  if (dimension === 'voice') return 'voice';
  if (dimension === 'stress' || dimension === 'resilience') return 'stress';
  if (dimension === 'teamwork' || dimension === 'leadership') return 'teamwork';
  return 'content';
}

function visualScore(input: ReportInput): number {
  const stats = input.visualStats;
  if (!stats) return 0;
  const eye = clampScore(stats.eyeContactRatio * 100);
  const steady = clampScore(stats.engagementRatio * 100);
  const calm = clampScore((1 - stats.nervousRatio) * 100);
  const head = clampScore((1 - stats.headPoseRatio) * 100);
  return clampScore(eye * 0.35 + steady * 0.25 + calm * 0.2 + head * 0.2);
}

function voiceRuleScore(m: RuleMetrics): number {
  const share = thresholdScore(m.voiceShareByTime, 35, 5);
  const freq = thresholdScore(m.userMessageCount, 8, 1);
  const rate = m.speakingRateWpm > 0 ? thresholdScore(140 - Math.abs(140 - m.speakingRateWpm), 140, 60) : 55;
  return clampScore(share * 0.4 + freq * 0.35 + rate * 0.25);
}

function communicationRuleScore(m: RuleMetrics): number {
  const filler = thresholdScore(5 - m.fillerRatio, 5, 0);
  const structure = thresholdScore(m.structureMarkerCount, 4, 0);
  const rate = m.speakingRateWpm > 0 ? thresholdScore(140 - Math.abs(140 - m.speakingRateWpm), 140, 60) : 55;
  return clampScore(filler * 0.35 + structure * 0.4 + rate * 0.25);
}

function recoveryScore(m: RuleMetrics): number {
  if (m.interruptRecoveryMs === null) return 70;
  return thresholdScore(3000 - m.interruptRecoveryMs, 3000, 0);
}

/** 群面八维 */
function lgdDimensions(input: ReportInput, m: RuleMetrics): Record<string, DimensionResult> {
  const sem = input.semantic ?? {};
  const visualOn = Boolean(input.visualEnabled);
  const dims: Record<string, DimensionResult> = {
    content: {
      score: blend(
        clampScore(
          thresholdScore(m.userMessageCount, 6, 1) * 0.4 +
            thresholdScore(m.pushDiscussionCount, 3, 0) * 0.3 +
            thresholdScore(m.structureMarkerCount, 3, 0) * 0.3
        ),
        sem.content
      ),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'content', PUSH_MARKERS),
      metrics: {
        观点数: m.userMessageCount,
        推动讨论次数: m.pushDiscussionCount,
        结构标记数: m.structureMarkerCount,
      },
      note: sem.content !== undefined ? '规则引擎实算 + AI 语义分析' : '规则引擎实算',
    },
    teamwork: {
      score: blend(
        clampScore(thresholdScore(m.responseCount, 4, 0) * 0.6 + thresholdScore(m.consensusCount, 2, 0) * 0.4),
        sem.teamwork
      ),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'teamwork', RESPONSE_MARKERS),
      metrics: { 回应他人次数: m.responseCount, 共识推进次数: m.consensusCount },
    },
    structure: {
      score: blend(clampScore(thresholdScore(m.structureMarkerCount, 5, 0)), sem.structure),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'structure', STRUCTURE_MARKERS),
      metrics: { 框架性发言标记: m.structureMarkerCount },
    },
    leadership: {
      score: blend(
        clampScore(thresholdScore(m.inviteCount, 3, 0) * 0.5 + thresholdScore(m.consensusCount, 2, 0) * 0.5),
        sem.leadership
      ),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'leadership', INVITE_MARKERS),
      metrics: { 邀请发言次数: m.inviteCount, 共识推进次数: m.consensusCount },
    },
    stress: {
      score: blend(clampScore(recoveryScore(m) * 0.6 + thresholdScore(m.interruptedCount, 0, 3) * 0.4), sem.stress),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'stress', RESPONSE_MARKERS),
      metrics: {
        被打断次数: m.interruptedCount,
        恢复时长ms: m.interruptRecoveryMs ?? '未被打断',
      },
    },
    communication: {
      score: blend(communicationRuleScore(m), sem.communication),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'communication', STRUCTURE_MARKERS),
      metrics: { 口头禅占比: `${m.fillerRatio}%`, 语速字每分: m.speakingRateWpm },
    },
    voice: {
      score: voiceRuleScore(m),
      max: 100,
      evidence: [],
      metrics: {
        话语权占比: `${m.voiceShareByTime}%`,
        发言总时长ms: m.userSpeakMs,
        发言频次: m.userMessageCount,
        单次平均时长ms: m.userMessageCount ? Math.round(m.userSpeakMs / m.userMessageCount) : 0,
        被打断次数: m.interruptedCount,
      },
    },
    visual: visualOn
      ? {
          score: visualScore(input),
          max: 100,
          status: 'enabled',
          evidence: [],
          metrics: {
            眼神接触: `${Math.round((input.visualStats?.eyeContactRatio ?? 0) * 100)}%`,
            紧张占比: `${Math.round((input.visualStats?.nervousRatio ?? 0) * 100)}%`,
          },
        }
      : {
          score: 0,
          max: 100,
          status: 'not_enabled',
          evidence: [],
          note: '本场未开启摄像头，视觉维度不参与评分，权重已按比例分摊至其余维度',
        },
  };
  return dims;
}

/** 单面九维 */
function panelDimensions(input: ReportInput, m: RuleMetrics): Record<string, DimensionResult> {
  const sem = input.semantic ?? {};
  const visualOn = Boolean(input.visualEnabled);
  const starRule = clampScore((m.starCount / 4) * 100);
  return {
    jobFit: {
      score: blend(clampScore(thresholdScore(m.userMessageCount, 6, 1) * 0.4 + starRule * 0.6), sem.jobFit),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'jobFit', STAR_MARKERS.action),
      metrics: { 回答条数: m.userMessageCount, STAR完整度: `${m.starCount}/4` },
      note: sem.jobFit !== undefined ? '面试官逐题评分 + AI 语义分析' : '规则引擎实算',
    },
    analysis: {
      score: blend(clampScore(thresholdScore(m.structureMarkerCount, 5, 0)), sem.analysis),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'analysis', STRUCTURE_MARKERS),
      metrics: { 结构化标记: m.structureMarkerCount },
    },
    star: {
      score: blend(starRule, sem.star),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'star', STAR_MARKERS.result),
      metrics: {
        情境: m.star.situation ? '有' : '缺',
        任务: m.star.task ? '有' : '缺',
        行动: m.star.action ? '有' : '缺',
        结果: m.star.result ? '有' : '缺',
      },
    },
    communication: {
      score: blend(communicationRuleScore(m), sem.communication),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'communication', STRUCTURE_MARKERS),
      metrics: { 口头禅占比: `${m.fillerRatio}%`, 语速字每分: m.speakingRateWpm },
    },
    growth: {
      score: blend(clampScore(thresholdScore(m.userMessageCount, 5, 1) * 0.5 + starRule * 0.5), sem.growth),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'growth', STAR_MARKERS.result),
      metrics: { 成长类回答条数: m.userMessageCount },
    },
    motivation: {
      score: blend(clampScore(thresholdScore(m.consensusCount + m.inviteCount, 3, 0) * 0.5 + 50 * 0.5), sem.motivation),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'motivation', ['希望', '想做', '规划', '长期', '认同']),
      metrics: { 动机表达标记: m.consensusCount + m.inviteCount },
    },
    resilience: {
      score: blend(clampScore(recoveryScore(m) * 0.6 + thresholdScore(m.userMessageCount, 5, 1) * 0.4), sem.resilience),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'resilience', RESPONSE_MARKERS),
      metrics: { 追问后回应次数: m.responseCount, 恢复时长ms: m.interruptRecoveryMs ?? '未被打断' },
    },
    questions: {
      score: blend(clampScore(thresholdScore(m.questionCount, 3, 0)), sem.questions),
      max: 100,
      evidence: evidenceFrom(input.transcripts, 'questions', ['？', '?']),
      metrics: { 反问问题数: m.questionCount },
    },
    voiceVisual: visualOn
      ? {
          score: clampScore(voiceRuleScore(m) * 0.6 + visualScore(input) * 0.4),
          max: 100,
          status: 'enabled',
          evidence: [],
          metrics: {
            话语权占比: `${m.voiceShareByTime}%`,
            眼神接触: `${Math.round((input.visualStats?.eyeContactRatio ?? 0) * 100)}%`,
          },
        }
      : {
          score: voiceRuleScore(m),
          max: 100,
          status: 'not_enabled',
          evidence: [],
          note: '本场未开启摄像头，仅评估语音表现，视觉权重已按比例分摊',
          metrics: { 话语权占比: `${m.voiceShareByTime}%`, 语速字每分: m.speakingRateWpm },
        },
  };
}

// ============================================================
// 报告组装
// ============================================================

const SUGGESTION_BY_DIMENSION: Record<string, string> = {
  content: '观点要更具体：每个结论后面补一条数据或一个具体场景，避免只给判断。',
  teamwork: '多回应他人：先复述对方要点，再给出你的补充或不同意见，让讨论真正接上。',
  structure: '主动搭框架：开场先给出讨论结构和时间分配，讨论中做阶段小结。',
  leadership: '有效推动而非强势主导：用提问把沉默的人拉进来，用共识句收束分歧。',
  stress: '被质疑时先接住再回应：承认对方合理的部分，再给出你的依据，不要急着反驳。',
  communication: '减少口头禅，控制语速：把「嗯、那个、就是」换成停顿，句子说完整。',
  voice: '提高话语权占比：发言次数偏少或单次过短，试着每次多说一层理由。',
  visual: '镜头前保持目光接触，减少低头看稿，坐姿稳定。',
  jobFit: '回答要贴岗位：把经历里的动作和岗位的关键能力一一对应起来。',
  analysis: '结论先行：先给判断，再分层给依据，最后收一句总结。',
  star: '用 STAR 讲经历：情境、任务、行动、结果四段齐全，结果要量化。',
  growth: '成长类问题要给具体例子：学过什么、怎么学的、带来了什么变化。',
  motivation: '动机要落到具体：为什么是这家公司、这个岗位，以及你三年内的规划。',
  resilience: '被追问时保持主线：先回答问题本身，再补充背景，不要跑题。',
  questions: '反问要体现思考：问业务难点、团队现状或岗位的衡量标准，别问官网能查到的。',
  voiceVisual: '注意语速与停顿，镜头前保持目光接触与稳定坐姿。',
};

function buildSuggestions(dimensions: Record<string, DimensionResult>, order: DimensionId[]): string[] {
  const ranked = order
    .map((id) => ({ id, score: dimensions[id]?.score ?? 0, status: dimensions[id]?.status }))
    .filter((d) => d.status !== 'not_enabled')
    .sort((a, b) => a.score - b.score);
  const out: string[] = [];
  for (const d of ranked) {
    if (out.length >= 4) break;
    const text = SUGGESTION_BY_DIMENSION[d.id];
    if (text) out.push(text);
  }
  if (out.length === 0) out.push('本场数据不足，建议完整参与一次再来查看报告。');
  return out;
}

/** 生成面后报告（纯函数，离线可测） */
export function buildReport(input: ReportInput): InterviewReport {
  const metrics = computeRuleMetrics(input.transcripts, input.events, input.sessionStartAt);
  const dimensions =
    input.format === 'panel' ? panelDimensions(input, metrics) : lgdDimensions(input, metrics);

  const excluded = excludedDimensions(input.format, Boolean(input.visualEnabled));
  const weights =
    input.weights ??
    weightsFor(input.format, {
      jobFamily: input.jobFamily,
      level: input.level,
      excluded,
    });

  const scores: Record<string, number> = {};
  for (const [key, dim] of Object.entries(dimensions)) scores[key] = dim.score;

  let overall = computeOverall(scores, weights);
  if (input.summaryByUser) overall = clampScore(overall + SUMMARY_BONUS);
  const band = scoreBand(overall);

  return {
    session_id: input.sessionId ?? null,
    format: input.format,
    overall_score: overall,
    band: band.label,
    band_advice: band.advice,
    core_focus: CORE_FOCUS[input.format],
    dimensions,
    weights,
    suggestions: buildSuggestions(dimensions, dimensionOrder(input.format)),
    created_at: new Date().toISOString(),
  };
}

/** 兼容旧调用：服务端分析链路用同一套引擎 */
export function buildRuleReport(input: ReportInput, semantic?: SemanticScores): InterviewReport {
  return buildReport({ ...input, semantic: semantic ?? input.semantic });
}

/** 报告里所有证据（扁平化，供落库与定位） */
export function collectEvidence(report: InterviewReport): Evidence[] {
  return Object.values(report.dimensions).flatMap((d) => d.evidence);
}
