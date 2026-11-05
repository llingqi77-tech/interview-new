/**
 * 设备检测与降级决策（PRD 3. 设备检测与准备）
 *
 * 麦克风 / 摄像头 / 扬声器 / 网络四连检，任一失败按降级策略处理：
 * - 麦克风失败 → 纯文字
 * - 跳过摄像头 → 纯语音（视觉维度不评分）
 * - 弱网 → 降级为纯语音/纯文字
 */

import type { InputMode } from './inputMode.ts';

export type CheckStatus = 'idle' | 'checking' | 'ok' | 'failed' | 'skipped';

export interface DeviceState {
  mic: CheckStatus;
  camera: CheckStatus;
  speaker: CheckStatus;
  network: CheckStatus;
  /** 实时音量 0-1 */
  micLevel: number;
  /** API 探测延迟（ms），null 表示未测 */
  networkLatencyMs: number | null;
}

export const INITIAL_DEVICE_STATE: DeviceState = {
  mic: 'idle',
  camera: 'idle',
  speaker: 'idle',
  network: 'idle',
  micLevel: 0,
  networkLatencyMs: null,
};

/** 弱网阈值：API 探测延迟超过该值即降级 */
export const WEAK_NETWORK_MS = 800;

/** 扬声器测试音文案（TTS 播报，确认能听到 AI 发言） */
export const SPEAKER_TEST_TEXT = '你好，我是本场的面试官，如果你能听到这句话，说明扬声器工作正常。';

/** 移动端提示（PRD 3.） */
export const MOBILE_HINTS = [
  '建议竖屏使用，横屏会压缩字幕区',
  'iOS Safari 切到后台会暂停音频，请保持页面在前台',
  '省电模式可能降低帧率，影响摄像头分析',
];

export type FacingMode = 'user' | 'environment';

export function nextFacingMode(current: FacingMode): FacingMode {
  return current === 'user' ? 'environment' : 'user';
}

export interface Degradation {
  voiceEnabled: boolean;
  cameraEnabled: boolean;
  /** 视觉维度是否参与评分 */
  visualScored: boolean;
  inputMode: InputMode;
  /** 是否发生降级 */
  degraded: boolean;
  reason: string;
}

export function resolveDegradation(state: DeviceState): Degradation {
  const micOk = state.mic === 'ok';
  const cameraOk = state.camera === 'ok';
  const weak = state.networkLatencyMs !== null && state.networkLatencyMs > WEAK_NETWORK_MS;
  const networkDown = state.network === 'failed';

  if (!micOk) {
    return {
      voiceEnabled: false,
      cameraEnabled: cameraOk,
      visualScored: cameraOk,
      inputMode: 'text',
      degraded: true,
      reason: '麦克风不可用，已切换为纯文字模式',
    };
  }
  if (networkDown) {
    return {
      voiceEnabled: true,
      cameraEnabled: cameraOk,
      visualScored: cameraOk,
      inputMode: 'webspeech',
      degraded: true,
      reason: '网络不可用，已降级为浏览器语音/文字',
    };
  }
  if (weak) {
    return {
      voiceEnabled: true,
      cameraEnabled: cameraOk,
      visualScored: cameraOk,
      inputMode: 'asr',
      degraded: true,
      reason: '网络较弱，已降级为按键说话',
    };
  }
  return {
    voiceEnabled: true,
    cameraEnabled: cameraOk,
    visualScored: cameraOk,
    inputMode: 'realtime',
    degraded: !cameraOk,
    reason: cameraOk ? '' : '未开启摄像头，本场为纯语音模式',
  };
}

/** 网络探测：连通性 + API 延迟 */
export async function probeNetwork(
  fetcher: (url: string) => Promise<Response> = (url) => fetch(url, { method: 'GET' })
): Promise<{ ok: boolean; latencyMs: number | null }> {
  const started = Date.now();
  try {
    const res = await fetcher('/api/health');
    const latencyMs = Date.now() - started;
    return { ok: res.ok, latencyMs };
  } catch {
    return { ok: false, latencyMs: null };
  }
}
