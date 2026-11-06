import React from 'react';
import type { InterviewFormat, InterviewerCard, Message, RoleCard } from '../types';
import type { SpeakingRight } from '../engine/speakingRight';
import type { TrajectoryState } from '../engine/trajectory';
import { INPUT_MODE_HINTS, INPUT_MODE_LABELS, type InputMode } from '../engine/inputMode';
import { formatCountdown } from '../engine/phaseEngine';

/**
 * 面试房间（PRD 4. 面试房间通用能力）
 *
 * 顶部状态栏：阶段名 + 阶段进度条 + 环形倒计时 + 题目查看 + 结束
 * 实时字幕区：用户右侧「我」/ AI 左侧头像·姓名·情绪·时间，流式输出，思考中
 * 发言轨迹条：最近 50 次发言迷你轨迹 + 发言总数
 * 发言权提示 / 底部工具条（静音·摄像头·语音输入·打断·文字输入）/ 侧边栏
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

export interface InterviewRoomProps {
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
  degraded?: string | null;
  /** 当前正在出声的角色 id（角色卡高亮） */
  speakingId?: string | null;
  /** 真人是否已说完自我介绍（显示「跳过 AI 自我介绍」） */
  canSkipAiIntro?: boolean;
  /** 正在录音（按键说话） */
  listening?: boolean;
  /** 实时识别中的半成品文本 */
  partialText?: string;
  onSend: (text: string) => void;
  onBargeIn: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleTextInput: () => void;
  onEnd: () => void;
  onViewTopic: () => void;
  onSkipAiIntro?: () => void;
}

const CountdownRing: React.FC<{ remainingMs: number; progress: number; label: string }> = ({
  remainingMs,
  progress,
  label,
}) => {
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, progress)));
  return (
    <div className="relative w-12 h-12 md:w-16 md:h-16 shrink-0" data-testid="countdown-ring" data-remaining={remainingMs}>
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e2dfd9" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="#0c0a08"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs font-bold text-ink tabular-nums">{formatCountdown(remainingMs)}</span>
        <span className="text-xs text-muted">{label}</span>
      </div>
    </div>
  );
};

const Bubble: React.FC<{ msg: Message; streaming: boolean }> = ({ msg, streaming }) => {
  const isUser = msg.senderId === 'user';
  const isSystem = msg.type === 'system';
  if (isSystem) {
    // 引导语字幕：居中展示，但保留播报人姓名与时间，便于回溯是谁在串场
    return (
      <div className="flex justify-center" data-side="center">
        <div className="glass-chip text-xs text-muted px-3 py-1.5 max-w-[92%] md:max-w-[86%] text-center">
          <span className="text-muted mr-1.5 whitespace-nowrap" data-time={msg.startMs ?? msg.timestamp}>
            {msg.senderName}
          </span>
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`} data-side={isUser ? 'right' : 'left'}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-subtle shrink-0 flex items-center justify-center text-xs font-bold text-ink">
          {msg.senderName.slice(0, 1)}
        </div>
      )}
      <div className={`max-w-[76%] ${isUser ? 'text-right' : 'text-left'}`}>
        <div className="flex items-center gap-2 text-xs text-muted mb-1" data-time={msg.startMs ?? msg.timestamp}>
          {isUser ? (
            <span className="font-semibold text-info">我</span>
          ) : (
            <>
              <span className="font-semibold text-muted">{msg.senderName}</span>
              <span data-emotion={msg.emotion ?? 'neutral'} className="glass-chip px-1.5 py-0.5">
                {msg.emotion ?? 'neutral'}
              </span>
            </>
          )}
          <span>{formatCountdown(msg.startMs ?? 0)}</span>
        </div>
        <div
          className={`glass-panel px-3 py-2 text-sm text-ink whitespace-pre-wrap ${isUser ? 'bg-subtle' : ''}`}
          data-streaming={streaming && !isUser ? 'true' : 'false'}
        >
          {msg.content}
        </div>
      </div>
    </div>
  );
};

const InterviewRoom: React.FC<InterviewRoomProps> = (props) => {
  const {
    format, phase, topic, keyPoints, messages, roles, interviewers,
    speakingRight, inputMode, thinking, streaming,
    muted, cameraOn, textInputOpen, degraded, speakingId, canSkipAiIntro, listening, partialText,
    onSend, onBargeIn, onToggleMute, onToggleCamera, onToggleTextInput, onEnd, onViewTopic, onSkipAiIntro,
  } = props;
  const [draft, setDraft] = React.useState('');
  const [mobilePanelOpen, setMobilePanelOpen] = React.useState(false);
  /** 发言高亮：优先用显式 speakingId，否则按发言权提示里的名字反查 */
  const activeId =
    speakingId ?? roles.find((r) => r.name === speakingRight.speakerName)?.id ?? null;

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div className="interview-room h-full flex flex-col gap-2">
      {/* 顶部状态栏 */}
      <div className="room-phase glass-panel px-2 md:px-4 py-2 flex flex-wrap items-center gap-2 md:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs md:text-sm font-bold text-ink whitespace-nowrap">{phase.label}</span>
            <span className="text-xs text-muted whitespace-nowrap">
              第 {phase.index + 1}/{phase.total} 阶段
            </span>
          </div>
          <div
            className="mt-1 h-1.5 w-full max-w-40 rounded-full bg-subtle overflow-hidden"
            data-testid="phase-progress"
          >
            <div className="h-full bg-ink" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <button
            type="button"
            onClick={onViewTopic}
            className="hidden md:inline-flex glass-btn-ghost text-xs px-3 py-1.5 whitespace-nowrap"
          >
            查看题目
          </button>
          <button
            type="button"
            onClick={() => setMobilePanelOpen((v) => !v)}
            className="md:hidden glass-btn-ghost text-xs px-2 py-1.5 whitespace-nowrap"
            data-testid="mobile-panel-toggle"
          >
            题目/角色
          </button>
          <CountdownRing remainingMs={phase.remainingMs} progress={phase.progress} label={phase.label} />
          <button
            type="button"
            onClick={onEnd}
            className="glass-btn-ghost text-xs md:text-xs px-2 md:px-3 py-1.5 whitespace-nowrap"
          >
            结束
          </button>
        </div>
      </div>

      {/* 移动端抽屉：侧边栏在窄屏隐藏，这里给同一份信息 */}
      {mobilePanelOpen && (
        <div className="md:hidden glass-panel p-3 space-y-2" data-testid="mobile-panel">
          <div>
            <div className="text-xs font-semibold text-ink mb-1">题目</div>
            <p className="text-xs text-muted leading-relaxed">
              {topic || '面试题目将在你完成自我介绍后，按目标岗位即时生成（STAR 结构化）'}
            </p>
          </div>
          {keyPoints.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-ink mb-1">讨论要点</div>
              <ul className="text-xs text-muted space-y-1">
                {keyPoints.map((k) => (
                  <li key={k}>· {k}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {format !== 'panel' &&
              roles.map((r) => (
                <span
                  key={r.id}
                  data-speaking={activeId === r.id ? 'true' : 'false'}
                  className={`glass-chip text-xs px-2 py-0.5 ${activeId === r.id ? 'outline outline-1 outline-strong text-ink' : 'text-muted'}`}
                >
                  {r.name}
                </span>
              ))}
            {interviewers.map((i) => (
              <span key={i.id} className="glass-chip text-xs px-2 py-0.5 text-muted">
                {i.name} · {i.archetype}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted">{phase.description}</p>
        </div>
      )}

      {degraded && (
        <div className="badge-warning rounded-xl px-3 py-1.5 text-xs text-warning" data-testid="degraded-banner">
          部分能力降级中：{degraded}
        </div>
      )}

      <div className="room-workspace relative flex-1 min-h-0 flex gap-2">
        {format === 'lgd' && phase.id === 'READING' && (
          <section className="reading-overlay" aria-label="审题" data-testid="reading-topic">
            <div className="reading-card">
              <div className="reading-top"><span>审题</span><time aria-label="审题剩余时间">{formatCountdown(phase.remainingMs)}</time></div>
              <h2>本场讨论题目</h2><p className="reading-question">{topic}</p>
              <p className="reading-note">请先阅读题目，倒计时结束后自动进入自我介绍。</p>
            </div>
          </section>
        )}
        {/* 字幕区 */}
        <div className="conversation-column flex-1 min-w-0 flex flex-col gap-2" inert={format === 'lgd' && phase.id === 'READING'}>
          <div className="room-transcript flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
            {messages.map((m) => (
              <Bubble key={m.id} msg={m} streaming={streaming} />
            ))}
            {thinking && (
              <div className="flex items-center gap-2 text-xs text-muted" data-testid="thinking">
                <span className="w-2 h-2 rounded-full bg-subtle animate-pulse" />
                思考中
              </div>
            )}
          </div>


          <div className="room-speaking text-xs text-muted" data-testid="speaking-right" data-kind={speakingRight.kind}>
            {speakingRight.label}
          </div>

          {listening && partialText && (
            <div className="glass-chip text-xs text-info px-3 py-1.5" data-testid="asr-partial">
              识别中：{partialText}
            </div>
          )}

          {textInputOpen && (
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
                placeholder={INPUT_MODE_HINTS[inputMode]}
                className="glass-input flex-1 px-3 py-2 text-sm"
              />
              <button type="button" onClick={submit} className="glass-btn-primary px-4 py-2 text-sm">
                发送
              </button>
            </div>
          )}

          {/* 底部工具条 */}
          <div className="room-toolbar glass-panel px-2 md:px-3 py-2 flex flex-wrap items-center gap-1.5 md:gap-2">
            <button
              type="button"
              onClick={onToggleMute}
              data-active={muted}
              className="glass-btn-ghost text-xs md:text-xs px-2 md:px-3 py-1.5 whitespace-nowrap"
            >
              {muted ? '取消静音' : '静音'}
            </button>
            <button
              type="button"
              onClick={onToggleCamera}
              data-active={cameraOn}
              className="glass-btn-ghost text-xs md:text-xs px-2 md:px-3 py-1.5 whitespace-nowrap"
            >
              {cameraOn ? '关闭摄像头' : '打开摄像头'}
            </button>
            <button
              type="button"
              onClick={onBargeIn}
              data-listening={listening ? 'true' : 'false'}
              className={`text-xs md:text-xs px-3 md:px-4 py-1.5 whitespace-nowrap ${
                listening ? 'glass-btn-danger' : 'glass-btn-primary'
              }`}
              title={INPUT_MODE_LABELS[inputMode]}
            >
              {listening ? '停止录音' : '语音输入'}
            </button>
            <button
              type="button"
              onClick={onBargeIn}
              className="glass-btn-ghost text-xs md:text-xs px-2 md:px-3 py-1.5 whitespace-nowrap"
            >
              打断 AI
            </button>
            <button
              type="button"
              onClick={onToggleTextInput}
              data-active={textInputOpen}
              className="glass-btn-ghost text-xs md:text-xs px-2 md:px-3 py-1.5 whitespace-nowrap"
            >
              文字输入
            </button>
            <span className="hidden md:inline text-xs text-muted ml-auto">{INPUT_MODE_LABELS[inputMode]}</span>
          </div>
        </div>

        {/* 侧边栏 */}
        <aside className="room-sidebar hidden md:flex md:w-72 shrink-0 flex-col gap-2 overflow-y-auto" inert={format === 'lgd' && phase.id === 'READING'}>
          <div className="glass-panel p-3">
            <div className="text-xs font-semibold text-ink mb-1">题目</div>
            <p className="text-xs text-muted leading-relaxed">
              {topic || '面试题目将在你完成自我介绍后，按目标岗位即时生成（STAR 结构化）'}
            </p>
            {keyPoints.length > 0 && (
              <>
                <div className="text-xs font-semibold text-ink mt-3 mb-1">讨论要点</div>
                <ul className="text-xs text-muted space-y-1">
                  {keyPoints.map((k) => (
                    <li key={k}>· {k}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="glass-panel p-3">
            <div className="text-xs font-semibold text-ink mb-2">
              {format === 'panel' ? '面试官' : '角色卡'}
            </div>
            <div className="space-y-1.5">
              {/* 群面渲染 AI 候选人；单面只渲染面试官（roles 是面试官的角色卡镜像，避免重复） */}
              {format !== 'panel' && roles.map((r) => (
                <div
                  key={r.id}
                  data-speaking={activeId === r.id ? 'true' : 'false'}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs ${
                    activeId === r.id ? 'bg-subtle text-ink' : 'text-muted'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-subtle flex items-center justify-center text-xs font-bold text-ink">
                    {r.name.slice(0, 1)}
                  </span>
                  <span>{r.name}</span>
                  <span className="text-muted">{r.background?.major ?? r.industry}</span>
                </div>
              ))}
              {interviewers.map((i) => (
                <div key={i.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted">
                  <span className="w-5 h-5 rounded-full bg-subtle flex items-center justify-center text-xs font-bold text-ink">
                    {i.name.slice(0, 1)}
                  </span>
                  <span>{i.name}</span>
                  <span className="text-muted">{i.archetype}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel p-3">
            <div className="text-xs font-semibold text-ink mb-1">阶段说明</div>
            <p className="text-xs text-muted leading-relaxed">{phase.description}</p>
            {canSkipAiIntro && onSkipAiIntro && (
              <button type="button" onClick={onSkipAiIntro} className="glass-btn-ghost text-xs px-2 py-1 mt-2 w-full">
                跳过 AI 候选人自我介绍
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default InterviewRoom;
