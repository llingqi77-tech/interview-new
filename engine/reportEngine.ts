import type { Evidence, GameEvent, Message, ReportV15, VisualStats } from '../types';
import { speechMsFromCharCount } from './speechRate.ts';
import { VISUAL_FULL } from './visionMetrics.ts';
import {
  clampScore,
  contentScore,
  formatSpeakBuckets,
  recoveryScore,
  stressScore,
  teamworkScore,
  visualDimension,
  visualScoringEnabled,
  voiceScore,
} from './reportDimensions.ts';

/**
 * 面后报告 v1.5 规则引擎（PRD 4.1.7 / 7.4 / 附录 C）
 * - 规则引擎实算：话语权占比、发言时长分布、被打断次数、回应次数、恢复速度
 * - LLM 处理语义维度（结构贡献、冲突处理、团队协调）——由 /api/analyze 注入
 * - 视觉维度（M6）：摄像头开启且数据充足（≥30 秒）时按 FINAL_WEIGHTS 计入综合分；
 *   否则走 M3 过渡权重 TRANSITION_WEIGHTS（视觉 not_enabled，现状不变）
 */

/** 视觉未开启/数据不足时的过渡权重（M3：内容 40 / 语音 25 / 抗压 20 / 协作 15） */
export const TRANSITION_WEIGHTS = { content: 40, voice: 25, visual: 0, stress: 20, teamwork: 15 } as const;

/**
 * 视觉维度启用时的综合分权重（PRD C.1 默认 15%，操作员指定 20%，其余四维按相对比例 ×0.8）
 * 改权重只改这一处。
 */
export const FINAL_WEIGHTS = { content: 28, voice: 16, visual: 20, stress: 16, teamwork: 8 } as const;

const FILLER_WORDS = ['嗯', '啊', '呃', '那个', '就是', '然后', '这个', '怎么说'];
const RESPONSE_MARKERS = ['同意', '赞同', '补充', '质疑', '回应', '反对', '认可', '支持'];
const PUSH_MARKERS = ['首先', '第一', '第二', '第三', '框架', '建议', '总结', '应该', '接下来', '角度'];
const STRUCTURE_MARKERS = ['首先', '其次', '最后', '第一', '第二', '第三', '综上', '方面', '要点'];

export interface ReportInput {
  transcripts: Message[];
  events: GameEvent[];
  sessionStartAt: number;
  durationMs: number;
}

export interface RuleMetrics {
  /** 用户发言条数占比 0-100 */
  voiceShareByCount: number;
  /** 用户发言时长占比 0-100（无时间戳时退化为条数占比） */
  voiceShareByTime: number;
  userSpeakMs: number;
  totalSpeakMs: number;
  userMessageCount: number;
  totalMessageCount: number;
  /** 填充词次数与占比 */
  fillerCount: number;
  fillerRatio: number;
  /** 语速（字/分钟，按带时间戳的用户发言估算） */
  speakingRateWpm: number;
  /** 用户被打断次数 */
  interruptedCount: number;
  /** 被打断后恢复时长（ms，取平均；未被打断为 null） */
  interruptRecoveryMs: number | null;
  /** 回应他人次数 */
  responseCount: number;
  /** 推动讨论次数（新角度/总结） */
  pushDiscussionCount: number;
  /** 结构标记出现次数（清晰度规则近似） */
  structureMarkerCount: number;
  /** 发言时长分布（每 5 分钟一段的用户发言字数） */
  timeDistribution: { bucketStartMs: number; userChars: number }[];
}

/** 发言时长估算：优先 endMs-startMs，否则按统一口径（SPEECH_CHARS_PER_SECOND） */
export function estimateSpeakMs(msg: Message): number {
  if (typeof msg.startMs === 'number' && typeof msg.endMs === 'number' && msg.endMs > msg.startMs) {
    return msg.endMs - msg.startMs;
  }
  return speechMsFromCharCount(msg.content.length);
}

function msgStartMs(msg: Message, sessionStartAt: number): number {
  if (typeof msg.startMs === 'number') return msg.startMs;
  return Math.max(0, msg.timestamp - sessionStartAt);
}

export function computeRuleMetrics(input: ReportInput): RuleMetrics {
  const { transcripts, events, sessionStartAt, durationMs } = input;
  const userMsgs = transcripts.filter((m) => m.senderId === 'user' && m.type === 'message');
  const allMsgs = transcripts.filter((m) => m.type === 'message');

  const userSpeakMs = userMsgs.reduce((sum, m) => sum + estimateSpeakMs(m), 0);
  const totalSpeakMs = allMsgs.reduce((sum, m) => sum + estimateSpeakMs(m), 0);

  const fillerCount = userMsgs.reduce((sum, m) => {
    return sum + FILLER_WORDS.reduce((s, w) => s + (m.content.split(w).length - 1), 0);
  }, 0);
  const userChars = userMsgs.reduce((sum, m) => sum + m.content.length, 0);

  // 语速：仅在用户发言带时间戳时可估算
  const timedUserMsgs = userMsgs.filter((m) => typeof m.startMs === 'number' && typeof m.endMs === 'number');
  const timedMs = timedUserMsgs.reduce((sum, m) => sum + (m.endMs! - m.startMs!), 0);
  const timedChars = timedUserMsgs.reduce((sum, m) => sum + m.content.length, 0);
  const speakingRateWpm = timedMs > 60_000 ? Math.round((timedChars / (timedMs / 60_000)) * 10) / 10 : 0;

  // 被打断次数（events: interrupt, target=user）
  const userInterrupts = events.filter((e) => e.event_type === 'interrupt' && e.target === 'user');
  const interruptedCount = userInterrupts.length;

  // 打断后恢复：从打断事件到用户下一条发言的时长
  const recoveries: number[] = [];
  for (const ev of userInterrupts) {
    const evAbs = sessionStartAt + ev.timestamp_ms;
    const nextUser = userMsgs.find((m) => m.timestamp >= evAbs && msgStartMs(m, sessionStartAt) >= ev.timestamp_ms);
    if (nextUser) recoveries.push(Math.max(0, nextUser.timestamp - evAbs));
  }
  const interruptRecoveryMs = recoveries.length > 0 ? Math.round(recoveries.reduce((a, b) => a + b, 0) / recoveries.length) : null;

  const responseCount = userMsgs.filter((m) => RESPONSE_MARKERS.some((k) => m.content.includes(k))).length;
  const pushDiscussionCount = userMsgs.filter((m) => PUSH_MARKERS.some((k) => m.content.includes(k))).length;
  const structureMarkerCount = userMsgs.reduce(
    (sum, m) => sum + STRUCTURE_MARKERS.filter((k) => m.content.includes(k)).length,
    0
  );

  // 发言时长分布（5 分钟一桶）
  const bucketMs = 5 * 60 * 1000;
  const buckets = new Map<number, number>();
  for (const m of userMsgs) {
    const b = Math.floor(msgStartMs(m, sessionStartAt) / bucketMs) * bucketMs;
    buckets.set(b, (buckets.get(b) ?? 0) + m.content.length);
  }
  const timeDistribution = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStartMs, userChars]) => ({ bucketStartMs, userChars }));

  return {
    voiceShareByCount: allMsgs.length > 0 ? Math.round((userMsgs.length / allMsgs.length) * 100) : 0,
    voiceShareByTime: totalSpeakMs > 0 ? Math.round((userSpeakMs / totalSpeakMs) * 100) : 0,
    userSpeakMs: Math.round(userSpeakMs),
    totalSpeakMs: Math.round(totalSpeakMs),
    userMessageCount: userMsgs.length,
    totalMessageCount: allMsgs.length,
    fillerCount,
    fillerRatio: userChars > 0 ? Math.round((fillerCount / userChars) * 1000) / 10 : 0,
    speakingRateWpm,
    interruptedCount,
    interruptRecoveryMs,
    responseCount,
    pushDiscussionCount,
    structureMarkerCount,
    timeDistribution,
  };
}

/** 证据池（PRD 7.3）：用户发言 → text 证据；打断事件 → event 证据 */
export function buildEvidencePool(input: ReportInput): Evidence[] {
  const { transcripts, events, sessionStartAt } = input;
  const pool: Evidence[] = [];
  let idx = 0;
  transcripts
    .filter((m) => m.senderId === 'user' && m.type === 'message')
    .forEach((m, i) => {
      idx += 1;
      const startMs = msgStartMs(m, sessionStartAt);
      const hint: Evidence['dimension_hint'] = PUSH_MARKERS.some((k) => m.content.includes(k))
        ? 'content'
        : RESPONSE_MARKERS.some((k) => m.content.includes(k))
          ? 'teamwork'
          : 'content';
      pool.push({
        id: `ev_${String(idx).padStart(3, '0')}`,
        modality: 'text',
        timestamp_ms: startMs,
        content: m.content,
        dimension_hint: hint,
        message_index: i,
      });
    });
  for (const ev of events) {
    if (ev.event_type === 'interrupt' && ev.target === 'user') {
      idx += 1;
      pool.push({
        id: `ev_${String(idx).padStart(3, '0')}`,
        modality: 'event',
        timestamp_ms: ev.timestamp_ms,
        content: `被 ${ev.actor} 打断（规则：${(ev.metadata as { rule?: string })?.rule ?? 'unknown'}）`,
        dimension_hint: 'stress',
      });
    }
  }
  return pool;
}

export interface LlmSemanticScores {
  /** 结构清晰度 0-100 */
  structureScore?: number;
  /** 回应质量 0-100 */
  responseQuality?: number;
  /** 被质疑后回应质量 0-100 */
  stressResponseQuality?: number;
  /** 冲突处理方式 0-100 */
  conflictHandling?: number;
  /** 支持/补充他人 0-100 */
  supportOthers?: number;
  /** 协调分歧 0-100 */
  coordinateOthers?: number;
  /** LLM 补充证据（原话 + 时间戳） */
  extraEvidence?: Evidence[];
}

export function buildRuleReport(input: ReportInput, llm?: LlmSemanticScores, visualStats?: VisualStats): ReportV15 {
  const metrics = computeRuleMetrics(input);
  const evidence = buildEvidencePool(input);
  const visualEnabled = visualScoringEnabled(visualStats);
  const weights = visualEnabled ? FINAL_WEIGHTS : TRANSITION_WEIGHTS;
  const recovered = recoveryScore(metrics);
  const content = contentScore(metrics, llm, weights.content);
  const voice = voiceScore(metrics, recovered, weights.voice);
  const stress = stressScore(evidence.filter((item) => item.dimension_hint === 'stress').length, llm, recovered, weights.stress);
  const teamwork = teamworkScore(metrics, llm, weights.teamwork);
  const visual = visualDimension(visualStats, visualEnabled, weights.visual);
  return assembleReport({
    metrics,
    evidence,
    llm,
    weights,
    scores: { content, voice, stress, teamwork },
    visual,
    visualStats: visualEnabled ? visualStats : undefined,
  });
}

function assembleReport(parts: {
  metrics: RuleMetrics;
  evidence: Evidence[];
  llm?: LlmSemanticScores;
  weights: typeof FINAL_WEIGHTS | typeof TRANSITION_WEIGHTS;
  scores: { content: number; voice: number; stress: number; teamwork: number };
  visual: ReportV15['dimensions']['visual'];
  visualStats?: VisualStats;
}): ReportV15 {
  const { metrics, evidence, llm, weights, scores, visual, visualStats } = parts;
  const contentEvidence = evidence.filter((item) => item.dimension_hint === 'content').slice(0, 5);
  const suggestions = buildSuggestions({
    m: metrics,
    content: scores.content,
    voice: scores.voice,
    stress: scores.stress,
    teamwork: scores.teamwork,
    visual: visualStats,
  });
  return {
    session_id: null,
    overall_score: clampScore(scores.content + scores.voice + scores.stress + scores.teamwork + visual.score),
    dimensions: {
      content: {
        score: scores.content,
        max: weights.content,
        evidence: [...contentEvidence, ...(llm?.extraEvidence ?? []).filter((item) => item.dimension_hint === 'content')].slice(0, 6),
        metrics: {
          观点数量: metrics.userMessageCount,
          结构标记次数: metrics.structureMarkerCount,
          推动讨论次数: metrics.pushDiscussionCount,
          回应次数: metrics.responseCount,
        },
      },
      voice: {
        score: scores.voice,
        max: weights.voice,
        evidence: evidence.slice(0, 3),
        metrics: {
          话语权占比: metrics.voiceShareByTime,
          填充词占比: metrics.fillerRatio,
          语速WPM: metrics.speakingRateWpm || 'N/A（文字版无 ASR 时间戳）',
          被打断次数: metrics.interruptedCount,
          平均恢复时长ms: metrics.interruptRecoveryMs ?? 'N/A',
          发言时段分布: formatSpeakBuckets(metrics),
        },
        note: '语音副语言特征需 ASR 时间戳（M2），当前为文字版规则近似',
      },
      visual,
      stress: {
        score: scores.stress,
        max: weights.stress,
        evidence: evidence.filter((item) => item.dimension_hint === 'stress').slice(0, 3),
        metrics: {
          被打断次数: metrics.interruptedCount,
          平均恢复时长ms: metrics.interruptRecoveryMs ?? 'N/A',
        },
      },
      teamwork: {
        score: scores.teamwork,
        max: weights.teamwork,
        evidence: evidence.filter((item) => item.dimension_hint === 'teamwork').slice(0, 3),
        metrics: {
          回应他人次数: metrics.responseCount,
        },
      },
    },
    suggestions,
  };
}

/** 改进建议（PRD F.4）：规则生成，LLM 版由 /api/analyze 覆盖 */
export function buildSuggestions(scores: {
  m: RuleMetrics;
  content: number;
  voice: number;
  stress: number;
  teamwork: number;
  /** 视觉统计（M6，仅在视觉维度参与评分时传入） */
  visual?: VisualStats;
}): string[] {
  const { m, content, voice, stress, teamwork, visual } = scores;
  const tips: string[] = [];
  if (m.voiceShareByTime < 25) tips.push('下次练习争取更早发言，前 3 分钟至少贡献 1 个核心观点');
  if (m.userMessageCount < 4) tips.push('增加有效发言次数，目标每场至少 5 次有观点的发言');
  if (content < 24) tips.push('发言使用"首先/其次/最后"结构化表达，让观点更清晰');
  if (voice < 15 && m.fillerRatio >= 3) tips.push(`减少口头填充词（当前约 ${m.fillerRatio}% 的字数含"嗯/那个"等）`);
  if (stress < 12 && m.interruptedCount > 0) tips.push('被质疑或打断后，先确认对方观点再回应，争取 3 秒内恢复');
  if (teamwork < 9) tips.push('多回应他人观点（同意并推进/质疑后给方案），目标每场回应 ≥3 次');
  // 视觉建议（M6，追加）：阈值与 PRD C.2 满分条件一致
  if (visual) {
    if (visual.eyeContactRatio < VISUAL_FULL.eyeContact) tips.push('发言时多抬头直视摄像头，眼神接触目标 ≥70%（当前不足）');
    if (visual.nervousRatio >= VISUAL_FULL.nervous) tips.push('放松面部表情，减少皱眉/嘴角下沉等紧张信号（当前紧张占比 ≥20%）');
    if (visual.headPoseRatio >= VISUAL_FULL.headPose) tips.push('减少低头与头部偏转，保持面部正对镜头（当前低头/偏头占比 ≥30%）');
  }
  if (tips.length === 0) tips.push('表现均衡，尝试在总结阶段主动承担汇报，展示领导力');
  // 视觉维度参与评分时多一条维度建议（最多 6 条），否则维持 5 条上限
  return tips.slice(0, visual ? 6 : 5);
}
