import type { InterviewerCard, RoleCard } from '../types.ts';
import { generateCandidates } from '../data/roleCards.ts';
import { hostInterviewerFor, matchInterviewers } from '../data/interviewers.ts';

/**
 * 本场阵容（PRD 5. / 6.）
 * - 群面：1 位主持面试官 + 3 位 AI 候选人 + 真人 = 4 位候选人
 * - 单面：2（或 3）位面试官 + 真人 = 唯一候选人
 */

export interface LgdRoster {
  host: InterviewerCard;
  candidates: RoleCard[];
  /** 候选人总数（含真人） */
  totalCandidates: number;
}

export interface PanelRoster {
  interviewers: InterviewerCard[];
  candidates: RoleCard[];
  totalCandidates: number;
}

export function lgdRoster(input: { company: string; jobTitle: string; seed?: number }): LgdRoster {
  return {
    host: hostInterviewerFor({ company: input.company, jobTitle: input.jobTitle }),
    candidates: generateCandidates({ company: input.company, jobTitle: input.jobTitle, seed: input.seed }),
    totalCandidates: 4,
  };
}

export function panelRoster(input: {
  company: string;
  jobTitle: string;
  interviewerIds?: string[];
  count?: number;
}): PanelRoster {
  const count = input.count ?? input.interviewerIds?.length ?? 2;
  const all = matchInterviewers({ jobTitle: input.jobTitle, company: input.company, count: 6 });
  const picked = input.interviewerIds?.length
    ? input.interviewerIds
        .map((id) => all.find((i) => i.id === id))
        .filter((i): i is InterviewerCard => Boolean(i))
    : all.slice(0, count);
  const interviewers = picked.map((i, idx) => ({
    ...i,
    role: idx === 0 ? ('lead' as const) : ('support' as const),
  }));
  return { interviewers, candidates: [], totalCandidates: 1 };
}

/** 面试官卡 → 角色卡（会话控制器统一按 RoleCard 调度） */
export function interviewerToRoleCard(i: InterviewerCard): RoleCard {
  return {
    id: i.id,
    name: i.name,
    industry: i.jobFamilies[0] ?? 'general',
    persona: {
      traits: [i.archetype],
      speaking_style: '专业、克制、追问为主',
      conflict_strategy: 'question_frequently',
      cooperation_level: 0.6,
      leadership_tendency: 0.7,
      conflict_level: 'medium',
    },
    voice: { provider: 'stepfun', voice_id: i.voiceId, rate: 1, emotion_default: 'neutral' },
    avatar: { preset_id: i.avatar, emotion_set: ['neutral', 'serious'] },
    behavior: {
      speak_probability: 0.8,
      interrupt_probability: 0.2,
      avg_speak_duration: 25,
      response_to_challenge: 'question_frequently',
      summary_tendency: 0.2,
    },
  };
}
