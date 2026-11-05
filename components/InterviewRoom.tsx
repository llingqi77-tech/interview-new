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
    <div className="relative w-16 h-16" data-testid="countdown-ring" data-remaining={remainingMs}>
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="#22D3EE"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs font-bold text-white tabular-nums">{formatCountdown(remainingMs)}</span>
        <span className="text-[9px] text-white/45">{label}</span>
      </div>
    </div>
  );
};

const TrajectoryBar: React.FC<{ trajectory: TrajectoryState }> = ({ trajectory }) => {
  const max = Math.max(1, ...trajectory.points.map((p) => p.durationMs));
  return (
    <div className="glass-panel px-3 py-2" data-testid="trajectory-bar">
      <div className="flex items-center justify-between text-[10px] text-white/45 mb-1">
        <span>发言轨迹（最近 {trajectory.points.length} 次）</span>
        <span>发言总数 {trajectory.total}</span>
      </div>
      <div className="flex items-end gap-[2px] h-6">
        {trajectory.points.map((p, i) => (
          <span
            key={`${p.speakerId}-${i}`}
            title={`${p.speakerName} ${Math.round(p.durationMs / 1000)}s`}
            className={`w-1.5 rounded-sm ${p.isUser ? 'bg-cyan-300' : 'bg-violet-300/70'}`}
            style={{ height: `${Math.max(12, (p.durationMs / max) * 100)}%` }}
          />
        ))}
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
        <div className="glass-chip text-[11px] text-white/60 px-3 py-1.5 max-w-[86%] text-center">
          <span className="text-white/40 mr-1.5" data-time={msg.startMs ?? msg.timestamp}>
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
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400/70 to-cyan-400/70 shrink-0 flex items-center justify-center text-[11px] font-bold text-white">
          {msg.senderName.slice(0, 1)}
        </div>
      )}
      <div className={`max-w-[76%] ${isUser ? 'text-right' : 'text-left'}`}>
        <div className="flex items-center gap-2 text-[10px] text-white/40 mb-1" data-time={msg.startMs ?? msg.timestamp}>
          {isUser ? (
            <span className="font-semibold text-cyan-200">我</span>
          ) : (
            <>
              <span className="font-semibold text-white/70">{msg.senderName}</span>
              <span data-emotion={msg.emotion ?? 'neutral'} className="glass-chip px-1.5 py-0.5">
                {msg.emotion ?? 'neutral'}
              </span>
            </>
          )}
          <span>{formatCountdown(msg.startMs ?? 0)}</span>
        </div>
        <div
          className={`glass-panel px-3 py-2 text-sm text-white/85 whitespace-pre-wrap ${isUser ? 'bg-cyan-400/10' : ''}`}
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
    speakingRight, trajectory, inputMode, thinking, streaming,
    muted, cameraOn, textInputOpen, degraded, speakingId, canSkipAiIntro, listening, partialText,
    onSend, onBargeIn, onToggleMute, onToggleCamera, onToggleTextInput, onEnd, onViewTopic, onSkipAiIntro,
  } = props;
  const [draft, setDraft] = React.useState('');
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
    <div className="h-full flex flex-col gap-2">
      {/* 顶部状态栏 */}
      <div className="glass-panel px-4 py-2 flex items-center gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">{phase.label}</span>
            <span className="text-[10px] text-white/40">
              第 {phase.index + 1}/{phase.total} 阶段
            </span>
          </div>
          <div className="mt-1 h-1.5 w-40 rounded-full bg-white/10 overflow-hidden" data-testid="phase-progress">
            <div className="h-full bg-gradient-to-r from-cyan-400 to-violet-400" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
          </div>
        </div>
        <div className="flex-1" />
        <button type="button" onClick={onViewTopic} className="glass-btn-ghost text-xs px-3 py-1.5">
          查看题目
        </button>
        <CountdownRing remainingMs={phase.remainingMs} progress={phase.progress} label={phase.label} />
        <button type="button" onClick={onEnd} className="glass-btn-ghost text-xs px-3 py-1.5">
          结束
        </button>
      </div>

      {degraded && (
        <div className="badge-warning rounded-xl px-3 py-1.5 text-xs text-amber-200" data-testid="degraded-banner">
          部分能力降级中：{degraded}
        </div>
      )}

      <div className="flex-1 min-h-0 flex gap-2">
        {/* 字幕区 */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
            {messages.map((m) => (
              <Bubble key={m.id} msg={m} streaming={streaming} />
            ))}
            {thinking && (
              <div className="flex items-center gap-2 text-xs text-white/50" data-testid="thinking">
                <span className="w-2 h-2 rounded-full bg-cyan-300 animate-pulse" />
                思考中
              </div>
            )}
          </div>

          <TrajectoryBar trajectory={trajectory} />

          <div className="glass-chip text-xs text-white/70 px-3 py-1.5" data-testid="speaking-right" data-kind={speakingRight.kind}>
            {speakingRight.label}
          </div>

          {listening && partialText && (
            <div className="glass-chip text-xs text-cyan-200 px-3 py-1.5" data-testid="asr-partial">
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
          <div className="glass-panel px-3 py-2 flex items-center gap-2">
            <button type="button" onClick={onToggleMute} data-active={muted} className="glass-btn-ghost text-xs px-3 py-1.5">
              {muted ? '取消静音' : '静音'}
            </button>
            <button type="button" onClick={onToggleCamera} data-active={cameraOn} className="glass-btn-ghost text-xs px-3 py-1.5">
              {cameraOn ? '关闭摄像头' : '打开摄像头'}
            </button>
            <button
              type="button"
              onClick={onBargeIn}
              data-listening={listening ? 'true' : 'false'}
              className={`text-xs px-4 py-1.5 ${listening ? 'glass-btn-danger' : 'glass-btn-primary'}`}
              title={INPUT_MODE_LABELS[inputMode]}
            >
              {listening ? '停止录音' : '语音输入'}
            </button>
            <button type="button" onClick={onBargeIn} className="glass-btn-ghost text-xs px-3 py-1.5">
              打断 AI
            </button>
            <button type="button" onClick={onToggleTextInput} data-active={textInputOpen} className="glass-btn-ghost text-xs px-3 py-1.5">
              文字输入
            </button>
            <div className="flex-1" />
            <span className="text-[10px] text-white/35">{INPUT_MODE_LABELS[inputMode]}</span>
          </div>
        </div>

        {/* 侧边栏 */}
        <aside className="hidden md:flex md:w-72 shrink-0 flex-col gap-2 overflow-y-auto">
          <div className="glass-panel p-3">
            <div className="text-xs font-semibold text-white/80 mb-1">题目</div>
            <p className="text-[11px] text-white/60 leading-relaxed">
              {topic || '面试题目将在你完成自我介绍后，按目标岗位即时生成（STAR 结构化）'}
            </p>
            {keyPoints.length > 0 && (
              <>
                <div className="text-xs font-semibold text-white/80 mt-3 mb-1">讨论要点</div>
                <ul className="text-[11px] text-white/60 space-y-1">
                  {keyPoints.map((k) => (
                    <li key={k}>· {k}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="glass-panel p-3">
            <div className="text-xs font-semibold text-white/80 mb-2">
              {format === 'panel' ? '面试官' : '角色卡'}
            </div>
            <div className="space-y-1.5">
              {/* 群面渲染 AI 候选人；单面只渲染面试官（roles 是面试官的角色卡镜像，避免重复） */}
              {format !== 'panel' && roles.map((r) => (
                <div
                  key={r.id}
                  data-speaking={activeId === r.id ? 'true' : 'false'}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] ${
                    activeId === r.id ? 'bg-cyan-400/15 text-white' : 'text-white/60'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-400/60 to-cyan-400/60 flex items-center justify-center text-[9px] font-bold text-white">
                    {r.name.slice(0, 1)}
                  </span>
                  <span>{r.name}</span>
                  <span className="text-white/30">{r.background?.major ?? r.industry}</span>
                </div>
              ))}
              {interviewers.map((i) => (
                <div key={i.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] text-white/60">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-300/60 to-rose-400/60 flex items-center justify-center text-[9px] font-bold text-white">
                    {i.name.slice(0, 1)}
                  </span>
                  <span>{i.name}</span>
                  <span className="text-white/30">{i.archetype}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel p-3">
            <div className="text-xs font-semibold text-white/80 mb-1">阶段说明</div>
            <p className="text-[11px] text-white/60 leading-relaxed">{phase.description}</p>
            {canSkipAiIntro && onSkipAiIntro && (
              <button type="button" onClick={onSkipAiIntro} className="glass-btn-ghost text-[11px] px-2 py-1 mt-2 w-full">
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
