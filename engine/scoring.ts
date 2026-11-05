import type { InterviewFormat } from '../types.ts';

/**
 * 打分机制（PRD 8. 打分机制）
 * 百分制：每个维度 0-100 子分 → 按权重加权求和 = 面试总分。
 * 权重合计恒为 100；纯语音模式剔除视觉维度后按比例分摊到其余维度。
 */

export type LgdDimensionId =
  | 'content' | 'teamwork' | 'structure' | 'leadership'
  | 'stress' | 'communication' | 'voice' | 'visual';

export type PanelDimensionId =
  | 'jobFit' | 'analysis' | 'star' | 'communication' | 'growth'
  | 'motivation' | 'resilience' | 'questions' | 'voiceVisual';

export type DimensionId = LgdDimensionId | PanelDimensionId;
export type WeightMap = Record<string, number>;

/** 无领导小组讨论权重（PRD 8. 权重分配，合计 100%） */
export const LGD_WEIGHTS: Record<LgdDimensionId, number> = {
  content: 20,
  teamwork: 20,
  structure: 15,
  leadership: 15,
  stress: 10,
  communication: 10,
  voice: 8,
  visual: 2,
};

/** 结构化单面权重（PRD 8. 权重分配，合计 100%） */
export const PANEL_WEIGHTS: Record<PanelDimensionId, number> = {
  jobFit: 25,
  analysis: 15,
  star: 15,
  communication: 10,
  growth: 10,
  motivation: 10,
  resilience: 10,
  questions: 3,
  voiceVisual: 2,
};

export const LGD_DIMENSION_ORDER: LgdDimensionId[] = [
  'content', 'teamwork', 'structure', 'leadership', 'stress', 'communication', 'voice', 'visual',
];
export const PANEL_DIMENSION_ORDER: PanelDimensionId[] = [
  'jobFit', 'analysis', 'star', 'communication', 'growth', 'motivation', 'resilience', 'questions', 'voiceVisual',
];

export const DIMENSION_LABELS: Record<DimensionId, string> = {
  content: '内容贡献',
  teamwork: '团队协作',
  structure: '结构贡献',
  leadership: '领导与影响力',
  stress: '抗压与冲突处理',
  communication: '沟通表达',
  voice: '语音表现',
  visual: '视觉表现',
  jobFit: '岗位匹配度',
  analysis: '综合分析能力',
  star: '行为与成果（STAR）',
  growth: '学习与成长潜力',
  motivation: '动机与价值观',
  resilience: '抗压与应变',
  questions: '反问质量',
  voiceVisual: '语音与视觉表现',
};

/** 评价官看什么（PRD 评估维度表「评估内容」列） */
export const DIMENSION_CRITERIA: Record<DimensionId, string> = {
  content: '观点是否有质量、是否紧扣题目、能否整合他人信息形成方案',
  teamwork: '是否倾听并回应他人、肯定/补充他人观点、化解争执达成一致',
  structure: '是否主动搭建讨论框架、推动流程、归纳总结',
  leadership: '是否引导讨论节奏、邀请他人发言、凝聚共识（有效推动而非强势主导）',
  stress: '面对质疑、观点被反对时的应对方式',
  communication: '表达是否清晰、有条理、有说服力',
  voice: '话语权与参与度是否均衡',
  visual: '镜头前的专注度与状态（纯语音模式不评估）',
  jobFit: '专业能力、知识储备与目标岗位的匹配程度',
  analysis: '问题拆解、逻辑推理、结构化表达',
  star: '行为类问题是否用 STAR（情境-任务-行动-结果）作答',
  growth: '学习能力、适应性与可塑性',
  motivation: '求职动机、职业规划、价值观与公司契合度',
  resilience: '面对追问与压力场景的应对质量',
  questions: '反问环节提问的水平（是否体现对岗位/公司的思考）',
  voiceVisual: '自信度与整体状态（纯语音模式只评估语音）',
};

/** 数据依据（PRD 评估维度表「数据依据」列） */
export const DIMENSION_DATA_SOURCES: Record<DimensionId, string> = {
  content: '转写文本语义分析：观点数、有效信息点、与题目要点的相关度、方案完整性',
  teamwork: '文本语义分析 + 对话关系：回应/衔接他人发言的频次、立场变化、推动达成一致的贡献',
  structure: '文本语义分析：框架性发言、流程推进语句、总结归纳语句的识别与统计',
  leadership: '文本 + 事件：发起议题、点名邀请发言、共识推进语句；观点被他人采纳的次数',
  stress: '事件日志 + 文本：被质疑后的回应质量、冲突场景下的理性程度',
  communication: '文本 + 语音特征：逻辑连贯性、语速、停顿/口头禅频次',
  voice: '语音特征统计：话语权占比、发言总时长、发言频次、单次发言时长、抢话/被打断次数',
  visual: '摄像头本地分析（0 字节上传）：目光方向、表情、姿态；未开启时标记「本场未开启」',
  jobFit: '面试官逐题评分 + 文本语义分析：回答与岗位关键能力要求的匹配度',
  analysis: '文本语义分析：回答结构（结论先行/总分总）、要点层级、论证链条完整性',
  star: '文本语义分析：STAR 四要素识别与完整性、事例的具体性',
  growth: '面试官评分 + 文本：成长类回答的具体性与深度',
  motivation: '面试官评分 + 文本语义分析：动机表达的真实性、规划清晰度、契合点',
  resilience: '事件 + 文本：追问后的思考时长、回答是否偏离主线、逻辑是否保持',
  questions: '文本语义分析：提问数量（2-3 个）、问题与岗位/公司的相关度、思考深度',
  voiceVisual: '语音特征（语速、音量、停顿、语气稳定性）+ 摄像头本地分析（表情、目光、姿态）',
};

/** 分数段解读（PRD 8.） */
export interface ScoreBand {
  min: number;
  max: number;
  label: string;
  advice: string;
}

export const SCORE_BANDS: ScoreBand[] = [
  { min: 90, max: 100, label: '优秀', advice: '表现突出，可直接进入下一轮' },
  { min: 80, max: 89, label: '良好', advice: '整体达标，个别维度仍有提升空间' },
  { min: 70, max: 79, label: '合格', advice: '基本达标，需要在弱项上刻意练习' },
  { min: 60, max: 69, label: '待提升', advice: '存在明显短板，建议针对弱项专项训练' },
  { min: 0, max: 59, label: '重点改进', advice: '需要系统性准备后再来一场' },
];

export function scoreBand(score: number): ScoreBand {
  const s = clampScore(score);
  return SCORE_BANDS.find((b) => s >= b.min && s <= b.max) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

export function clampScore(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** 总分 = Σ 维度得分 × 权重（权重为百分数） */
export function computeOverall(scores: Record<string, number>, weights: WeightMap): number {
  let total = 0;
  let weightSum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (!weight) continue;
    const score = Number.isFinite(scores[key]) ? scores[key] : 0;
    total += clampScore(score) * weight;
    weightSum += weight;
  }
  if (weightSum <= 0) return 0;
  return clampScore(total / weightSum);
}

/** 整数化并保证合计恰好 100（最大余数法） */
export function normalizeWeights(weights: WeightMap): WeightMap {
  const entries = Object.entries(weights).filter(([, v]) => Number.isFinite(v) && v > 0);
  const sum = entries.reduce((acc, [, v]) => acc + v, 0);
  const out: WeightMap = {};
  for (const key of Object.keys(weights)) out[key] = 0;
  if (sum <= 0) return out;
  const scaled = entries.map(([key, v]) => {
    const exact = (v / sum) * 100;
    return { key, floor: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let assigned = scaled.reduce((acc, s) => acc + s.floor, 0);
  scaled.sort((a, b) => b.rest - a.rest);
  for (const s of scaled) {
    if (assigned >= 100) break;
    s.floor += 1;
    assigned += 1;
  }
  for (const s of scaled) out[s.key] = s.floor;
  return out;
}

/**
 * 剔除某些维度后按比例分摊到其余维度（PRD 特殊规则①：纯语音模式不评估视觉表现）。
 * 例：群面剔除 visual(2%) → content 20/98*100 ≈ 20.41。
 */
export function redistribute(weights: WeightMap, excluded: string[]): WeightMap {
  const kept: WeightMap = {};
  for (const [key, value] of Object.entries(weights)) {
    kept[key] = excluded.includes(key) ? 0 : value;
  }
  const sum = Object.values(kept).reduce((a, b) => a + b, 0);
  if (sum <= 0) return kept;
  const out: WeightMap = {};
  for (const [key, value] of Object.entries(kept)) {
    out[key] = value === 0 ? 0 : (value / sum) * 100;
  }
  return out;
}

/** 岗位族权重微调（PRD 特殊规则②：权重支持按岗位类型与职级配置） */
export const JOB_FAMILY_TUNING: Record<string, WeightMap> = {
  tech: { jobFit: 5, analysis: 3, star: -2, communication: -2, growth: -2, motivation: -2 },
  product: { jobFit: 3, analysis: 2, communication: 2, star: -3, questions: -2, growth: -2 },
  finance: { jobFit: 5, analysis: 3, resilience: 2, star: -4, growth: -3, questions: -3 },
  supply: { jobFit: 4, analysis: 2, resilience: 2, star: -3, questions: -2, growth: -3 },
  consulting: { analysis: 5, communication: 3, jobFit: 2, star: -4, growth: -3, questions: -3 },
  marketing: { communication: 4, motivation: 3, jobFit: 2, analysis: -3, star: -3, questions: -3 },
  hr: { motivation: 4, communication: 3, growth: 2, analysis: -3, star: -3, questions: -3 },
  general: {},
};

/** 职级权重微调 */
export const LEVEL_TUNING: Record<string, WeightMap> = {
  intern: { growth: 5, motivation: 3, jobFit: -4, star: -4 },
  junior: { growth: 3, jobFit: 2, star: -3, leadership: -2 },
  senior: { jobFit: 4, star: 3, analysis: 2, growth: -5, motivation: -4 },
  lead: { jobFit: 5, star: 3, analysis: 3, growth: -6, motivation: -5 },
};

export interface WeightOptions {
  jobFamily?: string;
  level?: string;
  /** 显式覆盖（覆盖后其余维度按比例吸收差额，合计仍为 100） */
  overrides?: WeightMap;
  /** 不参与评分的维度（如纯语音模式剔除 visual） */
  excluded?: string[];
}

function applyDeltas(base: WeightMap, delta: WeightMap): WeightMap {
  const out: WeightMap = { ...base };
  for (const [key, d] of Object.entries(delta)) {
    if (out[key] === undefined) continue;
    out[key] = Math.max(0, out[key] + d);
  }
  return out;
}

function applyOverrides(weights: WeightMap, overrides: WeightMap): WeightMap {
  const out: WeightMap = { ...weights };
  const overridden = Object.keys(overrides).filter((k) => out[k] !== undefined);
  if (overridden.length === 0) return out;
  for (const key of overridden) out[key] = Math.max(0, overrides[key]);
  const fixedSum = overridden.reduce((acc, k) => acc + out[k], 0);
  const restKeys = Object.keys(out).filter((k) => !overridden.includes(k));
  const restSum = restKeys.reduce((acc, k) => acc + out[k], 0);
  const target = Math.max(0, 100 - fixedSum);
  if (restSum <= 0) {
    if (restKeys.length) for (const k of restKeys) out[k] = target / restKeys.length;
    return out;
  }
  for (const k of restKeys) out[k] = (out[k] / restSum) * target;
  return out;
}

/** 取某模式的权重表；无配置时返回标准权重（PRD 特殊规则②） */
export function weightsFor(format: InterviewFormat, options: WeightOptions = {}): WeightMap {
  const base: WeightMap = format === 'panel' ? { ...PANEL_WEIGHTS } : { ...LGD_WEIGHTS };
  let w = base;
  if (options.jobFamily && JOB_FAMILY_TUNING[options.jobFamily]) {
    w = applyDeltas(w, JOB_FAMILY_TUNING[options.jobFamily]);
  }
  if (options.level && LEVEL_TUNING[options.level]) {
    w = applyDeltas(w, LEVEL_TUNING[options.level]);
  }
  if (options.overrides) w = applyOverrides(w, options.overrides);
  if (options.excluded?.length) {
    return normalizeWeights(redistribute(w, options.excluded));
  }
  return normalizeWeights(w);
}

/** 维度顺序（报告渲染用） */
export function dimensionOrder(format: InterviewFormat): DimensionId[] {
  return format === 'panel' ? [...PANEL_DIMENSION_ORDER] : [...LGD_DIMENSION_ORDER];
}

/** 纯语音模式需要剔除的维度 */
export function excludedDimensions(format: InterviewFormat, visualEnabled: boolean): string[] {
  if (visualEnabled) return [];
  return format === 'panel' ? ['voiceVisual'] : ['visual'];
}
