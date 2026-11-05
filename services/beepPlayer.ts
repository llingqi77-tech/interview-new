import { BEEP_TONES, type BeepKind } from '../engine/beep.ts';

/**
 * 倒计时提示音播放（PRD 4.：每个小阶段都要有倒计时提示音）
 * 用 WebAudio 现场合成，不依赖音频文件，也不占网络。
 */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

export function playBeep(kind: BeepKind): void {
  const audio = getContext();
  if (!audio) return;
  const tone = BEEP_TONES[kind];
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = tone.frequency;
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + tone.durationMs / 1000);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + tone.durationMs / 1000 + 0.02);
}

export function disposeBeepPlayer(): void {
  void ctx?.close();
  ctx = null;
}
