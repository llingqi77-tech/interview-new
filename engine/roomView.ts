import type { InterviewFormat, InterviewerCard, Message, RoleCard } from '../types.ts';
import { currentPhase, getPhaseDefs, phaseProgress, phaseRemainingMs, type PhaseConfig, type PhaseState } from './phaseEngine.ts';
import { buildTrajectory, type TrajectoryState } from './trajectory.ts';
import { speakingRightOf, type SpeakingRight } from './speakingRight.ts';
import type { InputMode } from './inputMode.ts';

/**
 * 房间视图派生（PRD 4.）
 * 会话快照 → InterviewRoom 的纯展示数据。UI 只读，不自己算阶段/轨迹/发言权。
 */

export interface RoomPhaseView {
  id: string;
  label: string;
  index: number;
  total: number;
  remainingMs: number;
  progress: number;
  description: string;
}

export interface RoomViewInput {
  format: InterviewFormat;
  phaseState: PhaseState;
  phaseConfig?: PhaseConfig;
  now: number;
  topic: string;
  keyPoints: string[];
  messages: Message[];
  roles: RoleCard[];
  interviewers: InterviewerCard[];
  speakingCharId: string | null;
  thinking: boolean;
  streaming: boolean;
  inputMode: InputMode;
  degraded: string | null;
  muted: boolean;
  cameraOn: boolean;
  textInputOpen: boolean;
  canSkipAiIntro?: boolean;
}

export interface RoomView {
  format: InterviewFormat;
  phase: RoomPhaseView;
  topic: string;
  keyPoints: string[];
  messages: Message[];
  roles: RoleCard[];
  interviewers: InterviewerCard[];
  speakingRight: SpeakingRight;
  trajectory: TrajectoryState;
  inputMode: InputMode;
  thinking: boolean;
  streaming: boolean;
  muted: boolean;
  cameraOn: boolean;
  textInputOpen: boolean;
  degraded: string | null;
  speakingId: string | null;
  canSkipAiIntro: boolean;
}

export function buildRoomView(input: RoomViewInput): RoomView {
  const defs = getPhaseDefs(input.format, input.phaseConfig);
  const def = currentPhase(input.phaseState, input.format, input.phaseConfig);
  const speakingName = input.speakingCharId
    ? input.roles.find((r) => r.id === input.speakingCharId)?.name ??
      input.interviewers.find((i) => i.id === input.speakingCharId)?.name ??
      null
    : null;

  return {
    format: input.format,
    phase: {
      id: def.id,
      label: def.label,
      index: Math.min(input.phaseState.phaseIndex, defs.length - 1),
      total: defs.length,
      remainingMs: phaseRemainingMs(input.phaseState, input.now, input.format, input.phaseConfig),
      progress: phaseProgress(input.phaseState, input.now, input.format, input.phaseConfig),
      description: def.description,
    },
    topic: input.topic,
    keyPoints: input.keyPoints,
    messages: input.messages,
    roles: input.roles,
    interviewers: input.interviewers,
    speakingRight: speakingRightOf({
      userHasFloor: !input.speakingCharId && !input.thinking && !input.streaming && input.phaseState.finished === false && input.messages.length > 0 && input.messages[input.messages.length - 1]?.senderId === 'user',
      speakingName: speakingName ?? undefined,
      thinking: input.thinking,
    }),
    trajectory: buildTrajectory(input.messages),
    inputMode: input.inputMode,
    thinking: input.thinking,
    streaming: input.streaming,
    muted: input.muted,
    cameraOn: input.cameraOn,
    textInputOpen: input.textInputOpen,
    degraded: input.degraded,
    speakingId: input.speakingCharId,
    canSkipAiIntro: Boolean(input.canSkipAiIntro),
  };
}
