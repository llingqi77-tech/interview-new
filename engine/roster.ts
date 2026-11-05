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
