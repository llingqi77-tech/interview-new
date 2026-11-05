import type { CandidateBackground, RoleCard } from '../types';

/**
 * 首发 12 张角色卡（PRD 附录 A.2，字段结构见 A.1）
 * - 现有 3 角色（张强/李雅/王敏）的性格文案与行为规则迁入对应角色卡的
 *   persona.legacy_personality / behavior 字段，不丢弃（PRD 附录 A.3 / F.0）。
 * - 每场 3 张卡分配约束：行业匹配 ≥1；性格互补（1 高冲突 + 1 高协作 + 1 中立）；
 *   发言策略不重复；音色不重复；形象不重复。
 */

/** StepFun 音色编号 → 官方音色 ID（platform.stepfun.com 官方音色清单，每场 3 角色不重复） */
export const STEPFUN_VOICE_IDS: Record<string, string> = {
  voice_01: 'zhengpaiqingnian',   // 正派青年：激情感染力、说服力（科技远见者/加密先锋/运营总监）
  voice_02: 'shenchennanyin',     // 深沉男音：稳健权威（产品传奇/价值投资者/技术面试官）
  voice_03: 'shuangkuainansheng', // 爽快男声：利落务实（供应链大师/行业专家）
  voice_04: 'ganliannvsheng',     // 干练女声：高压快节奏（投行分析师/品牌总监/招聘经理）
  voice_05: 'zhixingjiejie',      // 知性姐姐：结构化专业（战略顾问）
};

/** 原 3 角色性格文案（从 constants.ts 迁移，作为角色卡 legacy 字段保留） */
const LEGACY_AGGRESSIVE =
  '强势控场型：开局倾向于抢占话语权。但在深入讨论环节，他会收敛锋芒，转而提出极具竞争力的战略观点，用数据或逻辑强力推动方案进展。';
const LEGACY_STRUCTURED =
  '逻辑枢纽型：擅长归纳提炼。在深入讨论时，她会从多维度补全方案，确保讨论不偏离核心指标。后期她会敏锐观察讨论进度，适时引导团队进入总结环节。';
const LEGACY_DETAIL =
  '务实执行型：关注可落地性。在深入讨论阶段，她会提出各种实际场景下的挑战，并给出可行的解决方案，为整体框架注入具体的血肉。';

export const ROLE_CARDS: RoleCard[] = [
  {
    id: 'tech_visionary',
    name: '科技远见者',
    industry: 'tech',
    persona: {
      traits: ['激进', '第一性原理', '爱挑战'],
      speaking_style: 'fast, assertive, data-driven',
      conflict_strategy: 'challenge_others',
      cooperation_level: 0.4,
      leadership_tendency: 0.8,
      conflict_level: 'high',
    },
    voice: { provider: 'stepfun', voice_id: STEPFUN_VOICE_IDS.voice_01, rate: 1.15, emotion_default: 'neutral' },
    avatar: { preset_id: 'visionary_01', emotion_set: ['neutral', 'positive', 'serious'] },
    behavior: {
      speak_probability: 0.85,
      interrupt_probability: 0.6,
      avg_speak_duration: 25,
      response_to_challenge: 'counter_attack',
      summary_tendency: 0.3,
    },
  },
  {
    id: 'product_legend',
    name: '产品传奇',
    industry: 'tech',
    persona: {
      traits: ['极简', '挑剔', '完美主义'],
      speaking_style: 'precise, critical, depth-seeking',
      conflict_strategy: 'question_frequently',
      cooperation_level: 0.5,
      leadership_tendency: 0.6,
      conflict_level: 'medium',
    },
    voice: { provider: 'stepfun', voice_id: STEPFUN_VOICE_IDS.voice_02, rate: 0.95, emotion_default: 'neutral' },
    avatar: { preset_id: 'legend_01', emotion_set: ['neutral', 'serious'] },
    behavior: {
      speak_probability: 0.7,
      interrupt_probability: 0.35,
      avg_speak_duration: 30,
      response_to_challenge: 'defend_with_depth',
      summary_tendency: 0.4,
    },
  },
  {
    id: 'supply_chain_master',
    name: '供应链大师',
    industry: 'tech',
    persona: {
      traits: ['稳健', '数据驱动'],
      speaking_style: 'steady, data-driven, coordinating',
      conflict_strategy: 'supplement_data',
      cooperation_level: 0.7,
      leadership_tendency: 0.5,
      conflict_level: 'low',
    },
    voice: { provider: 'stepfun', voice_id: STEPFUN_VOICE_IDS.voice_03, rate: 1.0, emotion_default: 'neutral' },
    avatar: { preset_id: 'master_01', emotion_set: ['neutral', 'positive'] },
    behavior: {
      speak_probability: 0.65,
      interrupt_probability: 0.2,
      avg_speak_duration: 25,
      response_to_challenge: 'reconcile',
      summary_tendency: 0.5,
    },
  },
  {
    id: 'crypto_pioneer',
    name: '加密先锋',
    industry: 'tech',
    persona: {
      traits: ['高调', '营销导向'],
      speaking_style: 'loud, hype-driven, attention-seeking',
      conflict_strategy: 'create_topics',
      cooperation_level: 0.35,
      leadership_tendency: 0.7,
      conflict_level: 'high',
    },
    voice: { provider: 'stepfun', voice_id: STEPFUN_VOICE_IDS.voice_01, rate: 1.2, emotion_default: 'positive' },
    avatar: { preset_id: 'pioneer_01', emotion_set: ['neutral', 'positive'] },
    behavior: {
      speak_probability: 0.8,
      interrupt_probability: 0.55,
      avg_speak_duration: 20,
      response_to_challenge: 'counter_attack',
      summary_tendency: 0.2,
    },
  },
  {
    id: 'value_investor',
    name: '价值投资者',
    industry: 'finance',
    persona: {
      traits: ['长期主义', '保守'],
      speaking_style: 'slow, conservative, summarizing',
      conflict_strategy: 'slow_speech_summary',
      cooperation_level: 0.5,
      leadership_tendency: 0.6,
      conflict_level: 'low',
    },
    voice: { provider: 'stepfun', voice_id: STEPFUN_VOICE_IDS.voice_02, rate: 0.8, emotion_default: 'serious' },
    avatar: { preset_id: 'investor_01', emotion_set: ['neutral', 'serious'] },
    behavior: {
      speak_probability: 0.6,
      interrupt_probability: 0.15,
      avg_speak_duration: 30,
      response_to_challenge: 'patient_rebuttal',
      summary_tendency: 0.6,
    },
  },
  {
    id: 'ib_analyst',
    name: '投行分析师',
    industry: 'finance',
    persona: {
      traits: ['高压', '结果导向'],
      speaking_style: 'fast, result-driven, number-heavy',
      conflict_strategy: 'fast_rebuttal',
      cooperation_level: 0.3,
      leadership_tendency: 0.7,
      conflict_level: 'high',
      legacy_id: 'char1',
      legacy_name: '张强',
      legacy_personality: LEGACY_AGGRESSIVE,
    },
    voice: { provider: 'stepfun', voice_id: STEPFUN_VOICE_IDS.voice_04, rate: 1.25, emotion_default: 'tense' },
    avatar: { preset_id: 'analyst_01', emotion_set: ['neutral', 'tense', 'serious'] },
    behavior: {
      speak_probability: 0.85,
      interrupt_probability: 0.65,
      avg_speak_duration: 22,
      response_to_challenge: 'counter_attack',
      summary_tendency: 0.25,
    },
  },
  {
    id: 'strategy_consultant',
    name: '战略顾问',
    industry: 'consulting',
    persona: {
      traits: ['结构化', 'MECE'],
      speaking_style: 'structured, framework-driven, guiding',
      conflict_strategy: 'framework_speech',
      cooperation_level: 0.75,
      leadership_tendency: 0.8,
      conflict_level: 'low',
      legacy_id: 'char2',
      legacy_name: '李雅',
      legacy_personality: LEGACY_STRUCTURED,
    },
    voice: { provider: 'stepfun', voice_id: STEPFUN_VOICE_IDS.voice_05, rate: 1.0, emotion_default: 'neutral' },
    avatar: { preset_id: 'consultant_01', emotion_set: ['neutral', 'positive', 'serious'] },
    behavior: {
      speak_probability: 0.75,
      interrupt_probability: 0.25,
      avg_speak_duration: 28,
      response_to_challenge: 'reframe',
      summary_tendency: 0.7,
    },
  },
  {
    id: 'brand_director',
    name: '品牌总监',
    industry: 'fmcg',
    persona: {
      traits: ['创意', '感性'],
      speaking_style: 'emotional, storytelling, inspiring',
      conflict_strategy: 'storytelling',
      cooperation_level: 0.65,
      leadership_tendency: 0.5,
      conflict_level: 'low',
    },
    voice: { provider: 'stepfun', voice_id: STEPFUN_VOICE_IDS.voice_04, rate: 1.0, emotion_default: 'positive' },
    avatar: { preset_id: 'brand_01', emotion_set: ['neutral', 'positive'] },
    behavior: {
      speak_probability: 0.7,
      interrupt_probability: 0.3,
      avg_speak_duration: 25,
      response_to_challenge: 'emotional_appeal',
      summary_tendency: 0.35,
    },
  },
  {
    id: 'ops_director',
    name: '运营总监',
    industry: 'manufacturing',
    persona: {
      traits: ['务实', '流程导向'],
      speaking_style: 'pragmatic, process-oriented, cost-aware',
      conflict_strategy: 'focus_cost_efficiency',
      cooperation_level: 0.6,
      leadership_tendency: 0.4,
      conflict_level: 'low',
      legacy_id: 'char3',
      legacy_name: '王敏',
      legacy_personality: LEGACY_DETAIL,
    },
    voice: { provider: 'stepfun', voice_id: STEPFUN_VOICE_IDS.voice_03, rate: 1.0, emotion_default: 'neutral' },
    avatar: { preset_id: 'ops_01', emotion_set: ['neutral', 'serious'] },
    behavior: {
      speak_probability: 0.65,
      interrupt_probability: 0.2,
      avg_speak_duration: 25,
      response_to_challenge: 'practical_fix',
      summary_tendency: 0.45,
    },
  },
  {
    id: 'industry_expert',
    name: '行业专家',
    industry: 'medical_education',
    persona: {
      traits: ['严谨', '耐心'],
      speaking_style: 'rigorous, patient, corrective',
      conflict_strategy: 'supplement_background',
      cooperation_level: 0.6,
      leadership_tendency: 0.5,
      conflict_level: 'low',
    },
    voice: { provider: 'stepfun', voice_id: STEPFUN_VOICE_IDS.voice_05, rate: 0.9, emotion_default: 'neutral' },
    avatar: { preset_id: 'expert_01', emotion_set: ['neutral', 'serious'] },
    behavior: {
      speak_probability: 0.6,
      interrupt_probability: 0.2,
      avg_speak_duration: 30,
      response_to_challenge: 'correct_errors',
      summary_tendency: 0.4,
    },
  },
  {
    id: 'hr_manager',
    name: '招聘经理',
    industry: 'hr',
    persona: {
      traits: ['亲和', '行为面试'],
      speaking_style: 'warm, coordinating, consensus-building',
      conflict_strategy: 'coordinate_summarize',
      cooperation_level: 0.8,
      leadership_tendency: 0.6,
      conflict_level: 'low',
    },
    voice: { provider: 'stepfun', voice_id: STEPFUN_VOICE_IDS.voice_04, rate: 1.0, emotion_default: 'positive' },
    avatar: { preset_id: 'hr_01', emotion_set: ['neutral', 'positive'] },
    behavior: {
      speak_probability: 0.7,
      interrupt_probability: 0.15,
      avg_speak_duration: 25,
      response_to_challenge: 'mediate',
      summary_tendency: 0.6,
    },
  },
  {
    id: 'tech_interviewer',
    name: '技术面试官',
    industry: 'internet',
    persona: {
      traits: ['逻辑', '深度'],
      speaking_style: 'logical, deep-diving, stress-testing',
      conflict_strategy: 'probe_details',
      cooperation_level: 0.4,
      leadership_tendency: 0.6,
      conflict_level: 'medium',
    },
    voice: { provider: 'stepfun', voice_id: STEPFUN_VOICE_IDS.voice_02, rate: 1.05, emotion_default: 'serious' },
    avatar: { preset_id: 'tech_01', emotion_set: ['neutral', 'serious', 'tense'] },
    behavior: {
      speak_probability: 0.8,
      interrupt_probability: 0.5,
      avg_speak_duration: 25,
      response_to_challenge: 'counter_attack',
      summary_tendency: 0.3,
    },
  },
];

/** 行业 → 关键词映射（用于 SetupForm 岗位行业匹配） */
export const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  tech: ['技术', '开发', '算法', '工程师', '前端', '后端', '数据', '测试', '运维', '架构'],
  finance: ['金融', '投资', '银行', '证券', '基金', '风控', '财务', '审计', '会计'],
  consulting: ['咨询', '战略', '商分', '商业分析'],
  fmcg: ['快消', '市场', '品牌', '营销', '销售', '运营', '广告'],
  manufacturing: ['制造', '供应链', '生产', '物流', '采购', '工业'],
  medical_education: ['医疗', '教育', '医药', '医生', '教师', '培训'],
  hr: ['hr', '人力', '招聘', '行政', '职能'],
  internet: ['互联网', '产品', '运营', '增长'],
};

/** 根据岗位名称推断行业 */
export function inferIndustry(jobTitle: string): string {
  const jt = (jobTitle || '').toLowerCase();
  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (keywords.some((k) => jt.includes(k.toLowerCase()))) return industry;
  }
  return 'internet';
}

/** 角色卡展示角色（兼容原 AGGRESSIVE / STRUCTURED / DETAIL 徽标与枢纽型逻辑） */
export function cardDisplayRole(card: RoleCard): 'AGGRESSIVE' | 'STRUCTURED' | 'DETAIL' {
  if (card.persona.conflict_level === 'high') return 'AGGRESSIVE';
  if (card.persona.cooperation_level >= 0.7 || card.persona.leadership_tendency >= 0.75) return 'STRUCTURED';
  return 'DETAIL';
}

export function findRoleCard(id: string): RoleCard | undefined {
  return ROLE_CARDS.find((c) => c.id === id);
}

// ============================================================
// AI 候选人背景生成（PRD 5. AI 候选人背景设计规范）
// 学历本科及以上且层次有区别 / 专业互异 / 实习与目标公司岗位匹配 / 三人互不相同
// ============================================================

const CANDIDATE_NAMES = [
  '林清', '周野', '苏芮', '陈嘉禾', '许知远', '沈亦舟',
  '顾南', '唐棠', '白露', '程野', '叶青', '罗一鸣',
];

const CANDIDATE_MAJORS = [
  '工商管理', '经济学', '计算机科学与技术', '统计学', '市场营销',
  '工业工程', '金融学', '心理学', '新闻传播学', '信息管理与信息系统',
  '物流管理', '社会学',
];

const CANDIDATE_SCHOOLS = [
  '985 院校', '211 院校', '双一流院校', '海外 QS 前 100', '财经类强校', '理工类强校',
];

/** 学历组合：保证 3 人里至少两种层次 */
const EDUCATION_COMBOS: CandidateBackground['education'][][] = [
  ['本科', '硕士', '本科'],
  ['硕士', '本科', '博士'],
  ['本科', '硕士', '硕士'],
  ['硕士', '博士', '本科'],
  ['本科', '博士', '硕士'],
];

/** 候选人可用音色（主持面试官保留 voice_05，保证每人独立音色） */
const CANDIDATE_VOICES = [
  STEPFUN_VOICE_IDS.voice_01,
  STEPFUN_VOICE_IDS.voice_02,
  STEPFUN_VOICE_IDS.voice_03,
  STEPFUN_VOICE_IDS.voice_04,
];

/** 候选人形象（与 12 张角色卡解耦，按岗位行业挑 3 个不同形象） */
const CANDIDATE_AVATARS = ['candidate_01', 'candidate_02', 'candidate_03', 'candidate_04', 'candidate_05'];

function seededRandom(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) % 2147483647;
  if (s === 0) s = 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function pickDistinct<T>(pool: T[], count: number, rand: () => number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  while (out.length < count && copy.length > 0) {
    const i = Math.floor(rand() * copy.length) % copy.length;
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

export interface GenerateCandidatesInput {
  company: string;
  jobTitle: string;
  seed?: number;
}

/**
 * 按目标公司与岗位生成 3 位 AI 候选人。
 * 同一 seed 结果可复现；不同 seed 背景不同。
 */
export function generateCandidates(input: GenerateCandidatesInput): RoleCard[] {
  const seed = input.seed ?? Date.now();
  const rand = seededRandom(seed);
  const company = input.company || '目标公司';
  const jobTitle = input.jobTitle || '目标岗位';

  const names = pickDistinct(CANDIDATE_NAMES, 3, rand);
  const majors = pickDistinct(CANDIDATE_MAJORS, 3, rand);
  const schools = pickDistinct(CANDIDATE_SCHOOLS, 3, rand);
  const voices = pickDistinct(CANDIDATE_VOICES, 3, rand);
  const avatars = pickDistinct(CANDIDATE_AVATARS, 3, rand);
  const combo = EDUCATION_COMBOS[Math.floor(rand() * EDUCATION_COMBOS.length) % EDUCATION_COMBOS.length];

  const internshipTemplates = [
    `${company} ${jobTitle} 实习 6 个月`,
    `${company} 暑期 ${jobTitle} 实习`,
    `${company} ${jobTitle} 实习生（转正评估 A）`,
  ];

  const personas: RoleCard['persona'][] = [
    {
      traits: ['结构化', '爱搭框架', '推动流程'],
      speaking_style: '先给结论再给依据，语速中等',
      conflict_strategy: 'reframe',
      cooperation_level: 0.75,
      leadership_tendency: 0.8,
      conflict_level: 'low',
    },
    {
      traits: ['质疑型', '数据敏感', '爱追问'],
      speaking_style: '短句、反问多，喜欢用数字压人',
      conflict_strategy: 'challenge_others',
      cooperation_level: 0.4,
      leadership_tendency: 0.6,
      conflict_level: 'high',
    },
    {
      traits: ['务实', '细节控', '善收尾'],
      speaking_style: '具体、举例多，擅长把方案落到执行',
      conflict_strategy: 'compromise',
      cooperation_level: 0.7,
      leadership_tendency: 0.45,
      conflict_level: 'medium',
    },
  ];

  return names.map((name, i) => {
    const background: CandidateBackground = {
      education: combo[i],
      school: schools[i],
      major: majors[i],
      internship: internshipTemplates[i],
    };
    return {
      id: `candidate_${i + 1}_${seed % 100000}`,
      name,
      industry: inferIndustry(jobTitle),
      persona: personas[i],
      voice: {
        provider: 'stepfun',
        voice_id: voices[i],
        rate: [1.0, 1.08, 0.96][i],
        emotion_default: 'neutral',
      },
      avatar: { preset_id: avatars[i], emotion_set: ['neutral', 'positive', 'serious'] },
      behavior: {
        speak_probability: [0.8, 0.7, 0.6][i],
        interrupt_probability: [0.35, 0.5, 0.25][i],
        avg_speak_duration: [35, 28, 40][i],
        response_to_challenge: ['reframe', 'counter_attack', 'concede_and_extend'][i],
        summary_tendency: [0.5, 0.25, 0.35][i],
      },
      background,
    };
  });
}
