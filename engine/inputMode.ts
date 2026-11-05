/**
 * 输入方式降级链（PRD 4. 面试房间通用能力）
 * 实时全双工语音 → StepFun ASR 按键说话 → 浏览器语音兜底 → 纯文字输入
 */

export type InputMode = 'realtime' | 'asr' | 'webspeech' | 'text';

export const INPUT_MODE_CHAIN: InputMode[] = ['realtime', 'asr', 'webspeech', 'text'];

export const INPUT_MODE_LABELS: Record<InputMode, string> = {
  realtime: '实时全双工语音（免按键）',
  asr: '按键说话（StepFun ASR）',
  webspeech: '浏览器语音识别',
  text: '文字输入',
};

export const INPUT_MODE_HINTS: Record<InputMode, string> = {
  realtime: '直接说话即可，无需按键',
  asr: '按住麦克风说话，松开提交',
  webspeech: '使用浏览器内置语音识别',
  text: '键盘输入，回车发送',
};

export interface InputCapabilities {
  realtime: boolean;
  asr: boolean;
  webSpeech: boolean;
}

/** 按能力从高到低选第一个可用通道 */
export function resolveInputMode(caps: InputCapabilities): InputMode {
  if (caps.realtime) return 'realtime';
  if (caps.asr) return 'asr';
  if (caps.webSpeech) return 'webspeech';
  return 'text';
}

/** 降级一级（运行中某通道失败时调用） */
export function degradeInputMode(current: InputMode): InputMode {
  const i = INPUT_MODE_CHAIN.indexOf(current);
  return INPUT_MODE_CHAIN[Math.min(i + 1, INPUT_MODE_CHAIN.length - 1)];
}

export function isVoiceMode(mode: InputMode): boolean {
  return mode !== 'text';
}
