import type { Message, RoleCard } from '../../types.ts';
import type { ReplyParams } from '../../services/geminiService.ts';
import type { SpeakerKind } from './speakerKind.ts';

export interface ReplyRequestInput {
  card: RoleCard;
  topic: string;
  jobTitle: string;
  history: Message[];
  phase: string;
  currentKeyPoint: string | null;
  keyPointDiscussionCount: number;
  allKeyPointsDiscussed: boolean;
  allKeyPoints: readonly string[];
  currentKeyPointIndex: number;
  voiceMode: boolean;
  speakerKind: SpeakerKind;
  phaseRemainingMs: number;
  sessionId: number | null;
}

export function buildReplyParams(input: ReplyRequestInput): ReplyParams {
  return {
    card: input.card,
    topic: input.topic,
    jobTitle: input.jobTitle,
    history: input.history,
    phase: input.phase,
    currentKeyPoint: input.currentKeyPoint,
    keyPointDiscussionCount: input.keyPointDiscussionCount,
    allKeyPointsDiscussed: input.allKeyPointsDiscussed,
    allKeyPoints: [...input.allKeyPoints],
    currentKeyPointIndex: input.currentKeyPointIndex,
    voiceMode: input.voiceMode,
    speakerKind: input.speakerKind,
    phaseRemainingMs: input.phaseRemainingMs,
    sessionId: input.sessionId,
  };
}
