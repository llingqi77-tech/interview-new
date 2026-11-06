import React, { useState, useEffect, useRef } from 'react';
import type { InterviewFormat } from '../types';
import { MOBILE_HINTS, nextFacingMode, resolveDegradation, type DeviceState } from '../engine/deviceCheck';
import { CONSENT_SUMMARY } from '../engine/privacy';

/**
 * 设备检测与准备流程（PRD 4.1.2 / US-01 / 5.2）
 * 依次检测：麦克风（权限 + 输入音量）→ 摄像头（权限 + 画面预览）→ 扬声器 → 网络。
 * 移动端额外：前后摄像头切换、横竖屏提示、省电模式提示、移动网络提示。
 * 「跳过摄像头」→ 纯语音模式可进入。隐私同意（C4）后才保存转写与聚合特征。
 */

export interface DeviceCheckResult {
  cameraEnabled: boolean;
  voiceEnabled: boolean;
  facingMode: 'user' | 'environment';
  consentSaveTranscript: boolean;
  /** 按环境自动降级后的输入方式 */
  inputMode?: import('../engine/inputMode').InputMode;
  /** 降级原因（UI 横幅展示） */
  degradedReason?: string;
}

interface DeviceCheckProps {
  format?: InterviewFormat;
  onReady: (result: DeviceCheckResult) => void;
  onBack: () => void;
  /** 强制移动端视图（测试与窄屏预览用） */
  isMobile?: boolean;
}

type CheckStatus = 'pending' | 'checking' | 'passed' | 'failed' | 'skipped';

interface CheckItem {
  key: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

interface NetworkInfoLike {
  effectiveType?: string;
  saveData?: boolean;
  type?: string;
}

function getNetworkInfo(): NetworkInfoLike | undefined {
  return (navigator as unknown as { connection?: NetworkInfoLike }).connection;
}

const DeviceCheck: React.FC<DeviceCheckProps> = ({ onReady, onBack, format = 'lgd', isMobile: forceMobile }) => {
  const [micStatus, setMicStatus] = useState<CheckStatus>('pending');
  const [micLevel, setMicLevel] = useState(0);
  const [cameraStatus, setCameraStatus] = useState<CheckStatus>('pending');
  const [speakerStatus, setSpeakerStatus] = useState<CheckStatus>('pending');
  const [networkStatus, setNetworkStatus] = useState<CheckStatus>('pending');
  const [networkDetail, setNetworkDetail] = useState<string>('');
  // 摄像头默认关闭：未检测即视为跳过（纯语音模式），避免用户卡在「必须点一次摄像头」
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [consent, setConsent] = useState(false);
  const [orientationHint, setOrientationHint] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  /** 麦克风流与摄像头流分开持有：共用一个 ref 会互相覆盖，卸载时停不干净（麦克风/摄像头指示灯不熄） */
  const micStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  /** 扬声器测试音的收尾定时器（卸载时清理，避免对已卸载组件 setState） */
  const speakerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 最近一次 API 探测延迟（ms），null 表示未测到 */
  const networkLatencyRef = useRef<number | null>(null);

  const isMobile = forceMobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // 网络检测
  useEffect(() => {
    const conn = getNetworkInfo();
    const detail = conn ? `${conn.effectiveType ?? conn.type ?? 'unknown'}${conn.saveData ? '（省流模式）' : ''}` : '无法读取';
    setNetworkDetail(detail);
    const t0 = performance.now();
    fetch('/api/avatars/presets', { method: 'GET' })
      .then((res) => {
        const ms = Math.round(performance.now() - t0);
        networkLatencyRef.current = ms;
        setNetworkStatus(res.ok ? 'passed' : 'failed');
        setNetworkDetail(`${detail} · API 探测延迟 ${ms}ms`);
      })
      .catch(() => {
        networkLatencyRef.current = null;
        setNetworkStatus('failed');
        setNetworkDetail(`${detail} · API 不可达（弱网降级纯语音）`);
      });
  }, []);

  // 横竖屏提示（移动端）
  useEffect(() => {
    if (!isMobile) return;
    const check = () => {
      setOrientationHint(window.innerWidth > window.innerHeight ? '横屏模式：建议竖握手机获得最佳布局' : null);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [isMobile]);

  // 清理
  useEffect(() => {
    return () => {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      cameraStreamRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (speakerTimerRef.current) clearTimeout(speakerTimerRef.current);
      audioCtxRef.current?.close().catch(() => undefined);
    };
  }, []);

  /** 权限请求超时：浏览器把权限弹窗挂着不返回时，不能让用户卡在「检测中」 */
  const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        void p.finally(() => clearTimeout(t));
      }),
    ]);

  const startMicCheck = async () => {
    setMicStatus('checking');
    try {
      const stream = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: true }), 8000);
      // 重测前先停掉旧流，避免多路麦克风同时占用
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
      setMicStatus('passed');
    } catch {
      setMicStatus('failed');
    }
  };

  const startCameraCheck = async (mode: 'user' | 'environment' = facingMode) => {
    setCameraStatus('checking');
    try {
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode },
          audio: false,
        }),
        8000
      );
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraStatus('passed');
      setCameraEnabled(true); // 失败后重测成功 → 恢复摄像头可用（否则进房间时又被判为无摄像头）
    } catch {
      setCameraStatus('failed');
      setCameraEnabled(false);
    }
  };

  const switchCamera = async () => {
    const next = nextFacingMode(facingMode);
    setFacingMode(next);
    if (cameraStatus === 'passed') await startCameraCheck(next);
  };

  const playTestTone = async () => {
    setSpeakerStatus('checking');
    try {
      const ctx = audioCtxRef.current ?? new AudioContext();
      if (!audioCtxRef.current) audioCtxRef.current = ctx;
      // 浏览器自动播放策略下 ctx 可能是 suspended：不 resume 用户听不到声音，却会被标成「通过」
      if (ctx.state === 'suspended') await ctx.resume();
      if (ctx.state !== 'running') {
        setSpeakerStatus('failed');
        return;
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 440;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      if (speakerTimerRef.current) clearTimeout(speakerTimerRef.current);
      speakerTimerRef.current = setTimeout(() => {
        speakerTimerRef.current = null;
        setSpeakerStatus('passed');
      }, 500);
    } catch {
      setSpeakerStatus('failed');
    }
  };

  const skipCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    setCameraStatus('skipped');
    setCameraEnabled(false);
  };

  const micReady = micStatus === 'passed' || micStatus === 'failed'; // 失败也可继续（纯文字）
  const canEnter = micReady && consent && (cameraStatus !== 'pending' || !cameraEnabled);

  const statusIcon = (s: CheckStatus) =>
    s === 'passed' ? (
      <span className="glass-chip badge-success text-xs px-2 py-0.5">通过</span>
    ) : s === 'failed' ? (
      <span className="glass-chip badge-danger text-xs px-2 py-0.5">失败</span>
    ) : s === 'skipped' ? (
      <span className="glass-chip text-xs px-2 py-0.5 text-muted">已跳过</span>
    ) : s === 'checking' ? (
      <span className="glass-chip text-xs px-2 py-0.5 text-muted">
        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" strokeWidth="4" fill="none" stroke="currentColor"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        检测中
      </span>
    ) : (
      <span className="glass-chip text-xs px-2 py-0.5 text-muted">等待</span>
    );

  // 步骤条行卡状态：当前检测项微放大 + 渐变描边；完成项沉降
  const rowClass = (s: CheckStatus) =>
    `glass-card p-4 flex items-center justify-between gap-3 transition-all duration-300 ${
      s === 'checking' ? 'glass-selected' : s === 'passed' ? '' : ''
    }`;

  const stepNum = (n: number) => (
    <span className="glass-chip w-7 h-7 justify-center text-xs tabular-nums text-muted shrink-0">{n}</span>
  );
  return (
    <div className="device-page w-full max-w-2xl mx-auto glass-panel overflow-hidden">
      {/* 头部（替换原实色块） */}
      <div className="px-8 pt-10 pb-4 text-center">
        <h1 className="text-3xl md:text-4xl font-black text-ink tracking-tight">
          设备<span className="text-gradient-brand">检测</span>与准备
        </h1>
        <p className="text-muted text-sm mt-3">按提示逐项检测，随时可以跳过摄像头进入纯语音模式</p>
      </div>

      <div className="stagger px-8 pb-8 space-y-4">
        {/* 步骤 1：麦克风 */}
        <div className={rowClass(micStatus)}>
          <div className="flex items-start gap-3">
            {stepNum(1)}
            <div>
              <div className="font-semibold text-ink flex items-center gap-2">麦克风 {statusIcon(micStatus)}</div>
              <div className="text-xs text-muted mt-1">
                {micStatus === 'failed' ? '未获得麦克风权限，将使用纯文字模式' : '检测权限与输入音量（实时音量条）'}
              </div>
              {micStatus === 'passed' && (
                <div className="mt-2 h-2 w-48 bg-subtle rounded-full overflow-hidden">
                  <div className="h-full bg-success transition-all" style={{ width: `${micLevel}%` }} />
                </div>
              )}
            </div>
          </div>
          <button
            onClick={startMicCheck}
            disabled={micStatus === 'checking' || micStatus === 'passed'}
            className="glass-btn px-4 py-2 text-sm font-medium shrink-0"
          >
            {micStatus === 'passed' ? '已通过' : '开始检测'}
          </button>
        </div>

        {/* 步骤 2：摄像头 */}
        <div className={rowClass(cameraStatus)}>
          <div className="flex items-start gap-3 flex-1">
            {stepNum(2)}
            <div className="flex-1">
              <div className="font-semibold text-ink flex items-center gap-2">摄像头 {statusIcon(cameraStatus)}</div>
              <div className="text-xs text-muted mt-1">
                {cameraStatus === 'skipped' ? '已跳过摄像头（纯语音模式）' : '检测权限与画面预览'}
              </div>
              {cameraStatus === 'passed' && (
                /* 预览玻璃框：detected 后渐变描边 + 外发光 */
                <div className="mt-3 inline-block rounded-3xl p-[2px] bg-subtle">
                  <video ref={videoRef} muted playsInline className="w-40 h-28 bg-black rounded-[calc(1.5rem-2px)] object-cover" />
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={() => startCameraCheck()}
              disabled={cameraStatus === 'checking'}
              className="glass-btn px-4 py-2 text-sm font-medium"
            >
              {cameraStatus === 'passed' ? '已通过' : '开始检测'}
            </button>
            {isMobile && (
              <button onClick={switchCamera} className="glass-btn-ghost px-4 py-2 text-sm">
                切换摄像头（当前{facingMode === 'user' ? '前置' : '后置'}）
              </button>
            )}
            <button onClick={skipCamera} className="glass-btn-ghost px-4 py-2 text-sm">
              跳过摄像头
            </button>
          </div>
        </div>

        {/* 步骤 3：扬声器 */}
        <div className={rowClass(speakerStatus)}>
          <div className="flex items-start gap-3">
            {stepNum(3)}
            <div>
              <div className="font-semibold text-ink flex items-center gap-2">扬声器 {statusIcon(speakerStatus)}</div>
              <div className="text-xs text-muted mt-1">播放测试音，确认能听到 AI 发言</div>
            </div>
          </div>
          <button
            onClick={playTestTone}
            disabled={speakerStatus === 'passed'}
            className="glass-btn px-4 py-2 text-sm font-medium shrink-0"
          >
            {speakerStatus === 'passed' ? '已通过' : '播放测试音'}
          </button>
        </div>

        {/* 步骤 4：网络 */}
        <div className={rowClass(networkStatus)}>
          <div className="flex items-start gap-3">
            {stepNum(4)}
            <div>
              <div className="font-semibold text-ink flex items-center gap-2">网络 {statusIcon(networkStatus)}</div>
              <div className="text-xs text-muted mt-1">{networkDetail || '检测连通性与 API 探测延迟'}</div>
              {networkStatus === 'failed' && <div className="text-xs text-warning mt-1">弱网将自动降级为纯语音/纯文字模式</div>}
            </div>
          </div>
        </div>

        {/* 移动端专项提示：amber 玻璃横幅 */}
        {isMobile && (
          <div className="badge-warning rounded-2xl p-4 space-y-1">
            <div className="text-sm font-semibold text-warning">移动端提示</div>
            <ul className="text-xs text-warning list-disc pl-4 space-y-0.5">
              {orientationHint && <li>{orientationHint}</li>}
              {MOBILE_HINTS.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 隐私同意（C4）：玻璃 toggle */}
        <div className="glass-card p-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={consent}
              aria-label="同意保存转写文本与聚合特征"
              data-on={consent}
              onClick={() => setConsent(!consent)}
              className="glass-toggle mt-0.5"
            >
              <span className="glass-toggle-knob" />
            </button>
            <span className="text-sm text-muted">
              {CONSENT_SUMMARY}
              <span className="block mt-1 text-muted">
                摄像头分析全部在浏览器本地完成（0 字节上传）；第三方 API（DeepSeek / StepFun）按隐私政策处理数据。
              </span>
            </span>
          </div>
        </div>

        {/* 群面阶段说明（PRD 4.1.3）：阶段色圆点 */}
        <div className="glass-panel p-4">
          <div className="text-sm font-semibold text-ink mb-2">
            流程预览 · {format === 'panel' ? '结构化单面' : '无领导小组讨论（倒计时驱动，到点强制切换）'}
          </div>
          <ol className="text-xs text-muted space-y-1.5 list-decimal pl-4">
            {format === 'panel' ? (
              <>
                <li>自我介绍（1 分钟）</li>
                <li>面试官问答（8-10 分钟，主副面试官轮流提问与追问）</li>
                <li>反问面试官（2 分钟，2-3 个问题）→ 面后报告</li>
              </>
            ) : (
              <>
                <li><span className="inline-block w-1.5 h-1.5 rounded-full bg-stage-think mr-1 align-middle" />审题（3 分钟，暂不发言）</li>
                <li><span className="inline-block w-1.5 h-1.5 rounded-full bg-stage-speak mr-1 align-middle" />自我介绍（每人 1 分钟，共 4 分钟）</li>
                <li><span className="inline-block w-1.5 h-1.5 rounded-full bg-stage-discuss mr-1 align-middle" />自由讨论（15 分钟，可打断/抢话）</li>
                <li><span className="inline-block w-1.5 h-1.5 rounded-full bg-stage-summary mr-1 align-middle" />总结陈词（3 分钟）→ 面后报告</li>
              </>
            )}
          </ol>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onBack} className="glass-btn-ghost px-6 py-3 font-medium">
            上一步
          </button>
          <button
            onClick={() => {
              const state: DeviceState = {
                mic: micStatus === 'passed' ? 'ok' : 'failed',
                camera: cameraEnabled && cameraStatus === 'passed' ? 'ok' : 'skipped',
                speaker: speakerStatus === 'passed' ? 'ok' : 'skipped',
                network: networkStatus === 'failed' ? 'failed' : 'ok',
                micLevel,
                networkLatencyMs: networkLatencyRef.current,
              };
              const d = resolveDegradation(state);
              onReady({
                cameraEnabled: d.cameraEnabled,
                voiceEnabled: d.voiceEnabled,
                facingMode,
                consentSaveTranscript: consent,
                inputMode: d.inputMode,
                degradedReason: d.reason,
              });
            }}
            disabled={!canEnter}
            className="glass-btn-primary flex-1 py-3 font-bold text-base"
          >
            {format === 'panel' ? '进入单面房间' : '进入群面房间'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeviceCheck;
