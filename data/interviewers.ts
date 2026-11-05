import type { InterviewerCard, JobFamily } from '../types.ts';
import { STEPFUN_VOICE_IDS } from './roleCards.ts';

/**
 * 面试官形象（PRD 2. 结构化单面：从 6 个面试官形象中挑选）
 * 科技远见者 / 产品传奇 / 供应链大师 / 加密先锋 / 价值投资者 / 投行分析师
 *
 * 「岗位匹配」= 按岗位族把面试官与岗位对齐，避免出现「投行分析师面试后端工程师」这种差异过大的组合。
 */

/** 主持面试官专用音色（候选人不会用到，保证每人独立音色） */
export const HOST_VOICE_ID = STEPFUN_VOICE_IDS.voice_05;

export const INTERVIEWERS: InterviewerCard[] = [
  {
    id: 'visionary',
    archetype: '科技远见者',
    name: '陈锋',
    title: '技术副总裁',
    company: '',
    level: 'vp',
    yearsExperience: 12,
    jobFamilies: ['tech', 'product'],
    avatar: 'visionary_01',
    voiceId: STEPFUN_VOICE_IDS.voice_01,
    role: 'lead',
    bio: '一线技术出身，做过三次从 0 到 1 的架构重构，习惯用第一性原理追问技术选型的代价。',
  },
  {
    id: 'product_legend',
    archetype: '产品传奇',
    name: '林岚',
    title: '产品总监',
    company: '',
    level: 'director',
    yearsExperience: 10,
    jobFamilies: ['product', 'marketing', 'hr'],
    avatar: 'product_legend_01',
    voiceId: STEPFUN_VOICE_IDS.voice_02,
    role: 'lead',
    bio: '带过两款千万级 DAU 产品，擅长把模糊需求拆成可验证的假设，最讨厌没有数据支撑的判断。',
  },
  {
    id: 'supply_master',
    archetype: '供应链大师',
    name: '周正',
    title: '供应链总经理',
    company: '',
    level: 'head',
    yearsExperience: 15,
    jobFamilies: ['supply', 'general'],
    avatar: 'supply_master_01',
    voiceId: STEPFUN_VOICE_IDS.voice_03,
    role: 'lead',
    bio: '管过跨国工厂与区域仓网，习惯先问「最坏情况下你怎么兜底」。',
  },
  {
    id: 'crypto_pioneer',
    archetype: '加密先锋',
    name: 'Kai',
    title: '首席协议工程师',
    company: '',
    level: 'senior_manager',
    yearsExperience: 8,
    jobFamilies: ['tech', 'finance'],
    avatar: 'crypto_pioneer_01',
    voiceId: STEPFUN_VOICE_IDS.voice_01,
    role: 'lead',
    bio: '长期做分布式系统与链上协议，关注安全边界与激励设计，喜欢追问「如果对手是恶意的」。',
  },
  {
    id: 'value_investor',
    archetype: '价值投资者',
    name: '沈砚',
    title: '投资合伙人',
    company: '',
    level: 'vp',
    yearsExperience: 14,
    jobFamilies: ['finance', 'hr', 'consulting', 'general'],
    avatar: 'value_investor_01',
    voiceId: STEPFUN_VOICE_IDS.voice_02,
    role: 'lead',
    bio: '看长期现金流与组织质量，习惯用「三年后这家公司还在不在」来检验一个决定。',
  },
  {
    id: 'ib_analyst',
    archetype: '投行分析师',
    name: '许宁',
    title: '投行执行董事',
    company: '',
    level: 'director',
    yearsExperience: 9,
    jobFamilies: ['finance', 'consulting'],
    avatar: 'ib_analyst_01',
    voiceId: STEPFUN_VOICE_IDS.voice_04,
    role: 'lead',
    bio: '做过十余单并购，节奏极快，要求结论先行、数字精确到小数点后一位。',
  },
];

/** 主/副面试官分工（PRD 6. 结构化单面） */
export const PANEL_DUTIES = {
  lead: '主面试官：负责专业知识与过往经历的结构化面试（STAR 追问）',
  support: '副面试官：负责职业意愿匹配、职业规划相关的提问',
};

const JOB_FAMILY_KEYWORDS: { family: JobFamily; words: string[] }[] = [
  { family: 'tech', words: ['开发', '工程师', '算法', '后端', '前端', '数据', '运维', '测试', '架构', '安全', '客户端', '服务端', 'sre', 'devops', '研发'] },
  { family: 'product', words: ['产品', 'pm', '增长', '交互', '设计', '用户体验'] },
  { family: 'finance', words: ['金融', '投资', '量化', '风控', '银行', '证券', '基金', '财务', '审计', '投行', '研究'] },
  { family: 'supply', words: ['供应链', '采购', '物流', '仓储', '生产', '计划', '制造', '品质'] },
  { family: 'consulting', words: ['咨询', '战略', '顾问', '分析师'] },
  { family: 'marketing', words: ['市场', '品牌', '营销', '公关', '内容', '运营'] },
  { family: 'hr', words: ['人力', '招聘', 'hr', '组织', '培训', '薪酬'] },
];

/** 岗位 → 岗位族（用于面试官匹配与权重微调） */
export function inferJobFamily(jobTitle: string): JobFamily {
  const t = (jobTitle || '').toLowerCase();
  for (const { family, words } of JOB_FAMILY_KEYWORDS) {
    if (words.some((w) => t.includes(w))) return family;
  }
  return 'general';
}

/** 岗位匹配：优先取岗位族命中的面试官，不足时用通用型补齐 */
export function matchInterviewers(input: { jobTitle: string; company?: string; count?: number }): InterviewerCard[] {
  const count = input.count ?? 2;
  const family = inferJobFamily(input.jobTitle);
  const matched = INTERVIEWERS.filter((i) => i.jobFamilies.includes(family));
  const rest = INTERVIEWERS.filter((i) => !i.jobFamilies.includes(family));
  const picked = [...matched, ...rest].slice(0, count);
  return picked.map((i, idx) => ({
    ...i,
    company: input.company || i.company,
    role: idx === 0 ? 'lead' : 'support',
  }));
}

/** 无领导小组讨论的主持面试官：目标公司目标岗位的专业人士，manager 以上、≥3 年经验 */
export function hostInterviewerFor(input: { company: string; jobTitle: string }): InterviewerCard {
  const family = inferJobFamily(input.jobTitle);
  const base = INTERVIEWERS.find((i) => i.jobFamilies.includes(family)) ?? INTERVIEWERS[0];
  const level = base.level === 'manager' ? 'senior_manager' : base.level;
  return {
    ...base,
    company: input.company,
    level,
    yearsExperience: Math.max(3, base.yearsExperience),
    voiceId: HOST_VOICE_ID,
    role: 'host',
    bio: `${input.company} ${input.jobTitle} 方向的${base.title}，${base.yearsExperience} 年从业经验。${base.bio}`,
  };
}

export function findInterviewer(id: string): InterviewerCard | undefined {
  return INTERVIEWERS.find((i) => i.id === id);
}
