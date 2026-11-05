/**
 * 发言权提示（PRD 4.：当前发言权在你手中 / XX 正在发言可随时抢话 / AI 正在思考 / 等待调度器分配）
 */

export type SpeakingRightKind = 'user' | 'ai_speaking' | 'ai_thinking' | 'waiting';

export interface SpeakingRight {
  kind: SpeakingRightKind;
  label: string;
  speakerName?: string;
  /** 是否允许抢话（AI 发言时恒为 true） */
  canBargeIn: boolean;
}

export interface SpeakingRightInput {
  /** 发言权在真人手里 */
  userHasFloor?: boolean;
  /** 正在发言的 AI 名字 */
  speakingName?: string;
  /** AI 正在思考（LLM 生成中） */
  thinking?: boolean;
}

export function speakingRightOf(input: SpeakingRightInput): SpeakingRight {
  if (input.userHasFloor) {
    return { kind: 'user', label: '当前发言权在你手中', canBargeIn: false };
  }
  if (input.speakingName) {
    return {
      kind: 'ai_speaking',
      label: `${input.speakingName} 正在发言，可随时抢话`,
      speakerName: input.speakingName,
      canBargeIn: true,
    };
  }
  if (input.thinking) {
    return { kind: 'ai_thinking', label: 'AI 正在思考', canBargeIn: false };
  }
  return { kind: 'waiting', label: '等待调度器分配', canBargeIn: false };
}
