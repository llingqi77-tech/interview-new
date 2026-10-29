import type { Evidence, ReportV15, VisualStats } from '../types.ts';
import { isVisualDataSufficient, visualMetrics, VISUAL_MIN_ROWS } from './visionMetrics.ts';
import type { LlmSemanticScores, RuleMetrics } from './reportEngine.ts';

export interface ScoreWeights {
  content: number;
  voice: number;
  visual: number;
  stress: number;
  teamwork: number;
}

export function thresholdScore(value: number, full: number, empty: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= full) return 100;
  if (value <= empty) return 0;
  return Math.round(((value - empty) / (full - empty)) * 100);
}

export function weightedScore(raw: number, max: number): number {
  if (!Number.isFinite(raw) || !Number.isFinite(max)) return 0;
  return Math.round((raw / 100) * max);
}

export function clampScore(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function contentScore(metrics: RuleMetrics, llm: LlmSemanticScores | undefined, max: number): number {
  const opinions = thresholdScore(metrics.userMessageCount, 5, 1);
  const structure = llm?.structureScore ?? thresholdScore(metrics.structureMarkerCount, 3, 0);
  const push = thresholdScore(metrics.pushDiscussionCount, 3, 0);
  const response = llm?.responseQuality ?? thresholdScore(metrics.responseCount, 3, 0);
  const raw = opinions * 0.25 + structure * 0.25 + push * 0.25 + response * 0.25;
  return weightedScore(raw, max);
}

/** 打断后恢复分。语音和抗压共用，避免两处各写一个 3 秒阈值 */
export function recoveryScore(metrics: RuleMetrics): number {
  if (metrics.interruptRecoveryMs === null) return 70;
  return thresholdScore(3000 - metrics.interruptRecoveryMs, 3000, 0);
}

export function voiceScore(metrics: RuleMetrics, recovered: number, max: number): number {
  const rate = metrics.speakingRateWpm > 0 ? thresholdScore(metrics.speakingRateWpm, 140, 100) : 60;
  const filler = thresholdScore(5 - metrics.fillerRatio, 5, 0);
  const pause = metrics.userMessageCount >= 3 ? 70 : 50;
  const volume = 60;
  const raw = rate * 0.2 + filler * 0.2 + pause * 0.2 + recovered * 0.2 + volume * 0.2;
  return weightedScore(raw, max);
}

export function stressScore(
  metricsEvidenceCount: number,
  llm: LlmSemanticScores | undefined,
  recovered: number,
  max: number,
): number {
  const quality = llm?.stressResponseQuality ?? (metricsEvidenceCount > 0 ? 60 : 55);
  const conflict = llm?.conflictHandling ?? 60;
  const raw = quality * 0.5 + recovered * 0.3 + conflict * 0.2;
  return weightedScore(raw, max);
}

export function teamworkScore(metrics: RuleMetrics, llm: LlmSemanticScores | undefined, max: number): number {
  const respond = thresholdScore(metrics.responseCount, 3, 0);
  const support = llm?.supportOthers ?? respond;
  const coordinate = llm?.coordinateOthers ?? 55;
  const raw = respond * 0.4 + support * 0.3 + coordinate * 0.3;
  return weightedScore(raw, max);
}

export function visualDimension(
  visualStats: VisualStats | undefined,
  enabled: boolean,
  max: number,
): ReportV15['dimensions']['visual'] {
  if (enabled && visualStats) {
    return {
      score: weightedScore(visualStats.rawScore, max),
      max,
      status: 'enabled',
      evidence: visualStats.evidence,
      metrics: visualMetrics(visualStats),
    };
  }
  return {
    score: 0,
    max,
    status: 'not_enabled',
    evidence: [] as Evidence[],
    note: visualNote(visualStats),
  };
}

function visualNote(visualStats: VisualStats | undefined): string {
  if (visualStats !== undefined) {
    return `视觉数据不足（有效采样 ${visualStats.validRows} 秒 < ${VISUAL_MIN_ROWS} 秒），未参与评分`;
  }
  return '视觉维度未开启（摄像头分析未开启或已关闭），权重已按其余四维归一';
}

export function visualScoringEnabled(visualStats: VisualStats | undefined): boolean {
  return visualStats !== undefined && isVisualDataSufficient(visualStats.validRows);
}

export function formatSpeakBuckets(metrics: RuleMetrics): string {
  if (metrics.timeDistribution.length === 0) return 'N/A';
  return metrics.timeDistribution
    .slice(0, 5)
    .map((bucket) => `${Math.round(bucket.bucketStartMs / 60000)}min/${bucket.userChars}字`)
    .join(' ');
}
