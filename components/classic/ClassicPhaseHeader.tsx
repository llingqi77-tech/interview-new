import React, { useEffect, useState } from 'react';
import type { RoleCard } from '../../types';
import {
  currentPhase,
  currentOpeningSpeaker,
  phaseRemainingMs,
  phaseProgress,
  formatCountdown,
  INTRO_TURN_MS,
  type PhaseConfig,
  type PhaseState,
} from '../../engine/phaseEngine';

/**
 * 经典模式顶栏（M7 Phase 1 从 DiscussionPanel 抽取，渲染不变）：
 * 阶段信息 + 倒计时环（视觉焦点）+ 四阶段 chips + 降级横幅 + 提交按钮
 */

/** 四阶段配色（倒计时光环 / 阶段 chip 共用）：审题 cyan / 陈述 violet / 讨论 blue / 总结 amber */
export const STAGES = [
  { id: 'READING', short: '审题', color: '#22D3EE' },
  { id: 'INTRO', short: '陈述', color: '#A78BFA' },
  { id: 'FREE_DISCUSSION', short: '讨论', color: '#60A5FA' },
  { id: 'SUMMARY', short: '总结', color: '#FBBF24' },
] as const;

interface Props {
  phaseState: PhaseState;
  phaseConfig: PhaseConfig;
  roles: RoleCard[];
  degraded: boolean;
  topicOpen: boolean;
  onToggleTopic: () => void;
  onSubmit: () => void;
}

const ClassicPhaseHeader: React.FC<Props> = ({
  phaseState,
  phaseConfig,
  roles,
  degraded,
  topicOpen,
  onToggleTopic,
  onSubmit,
}) => {
  // 组件自计时：倒计时只在顶栏重渲染（250ms），不拖动整棵房间树
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const phase = currentPhase(phaseState, phaseState.format, phaseConfig);
  const remaining = phaseRemainingMs(phaseState, nowTs, phaseState.format, phaseConfig);
  const progress = phaseProgress(phaseState, nowTs, phaseState.format, phaseConfig);
  const openingSpeaker = currentOpeningSpeaker(phaseState, phaseConfig, phaseState.format);
  const openingRemaining =
    phase.id === 'INTRO' ? Math.max(0, INTRO_TURN_MS - (nowTs - phaseState.openingStartedAt)) : 0;
  const displayRemaining = phase.id === 'INTRO' ? Math.min(remaining, openingRemaining) : remaining;

  // 阶段视觉：当前阶段色驱动倒计时环 + chips；倒计时环周长（r=52）
  const stageIdx = Math.max(0, STAGES.findIndex((s) => s.id === phase.id));
  const stageColor = STAGES[stageIdx].color;
  const RING_C = 2 * Math.PI * 52;

  return (
    <div className="relative z-10 border-b border-white/10 bg-white/[0.06] backdrop-blur-xl max-md:backdrop-blur-none max-md:bg-slate-900/80 px-3 md:px-5 py-3">
      <div className="flex items-center gap-3 md:gap-5">
        {/* 左：阶段 + 进度 */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="glass-chip w-10 h-10 justify-center rounded-2xl shrink-0" style={{ color: stageColor }}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-black text-white tracking-tight truncate">
              {phase.label}
              {phase.id === 'INTRO' && openingSpeaker && (
                <span className="ml-2" style={{ color: stageColor }}>
                  {openingSpeaker === 'user' ? '轮到你陈述' : `${roles.find((c) => c.id === openingSpeaker)?.name ?? ''} 陈述中`}
                </span>
              )}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <div className="h-1 w-24 md:w-32 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full transition-all duration-500" style={{ width: `${progress * 100}%`, background: stageColor }} />
              </div>
              <span className="text-[10px] text-white/40 font-bold">阶段进度</span>
            </div>
          </div>
        </div>

        {/* 中：倒计时环（液态折射层 + 阶段色进度弧发光） */}
        <div className="liquid relative w-24 h-24 md:w-36 md:h-36 shrink-0" aria-label="阶段倒计时">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="7" />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke={stageColor}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - Math.min(1, Math.max(0, progress)))}
              style={{ filter: `drop-shadow(0 0 6px ${stageColor})`, transition: 'stroke-dashoffset 0.3s linear, stroke 0.5s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-xl md:text-4xl font-black text-white tabular-nums leading-none">{formatCountdown(displayRemaining)}</div>
            <div className="text-[8px] md:text-[9px] text-white/40 font-bold uppercase tracking-widest mt-1">剩余时间</div>
          </div>
        </div>

        {/* 右：操作 */}
        <div className="flex flex-col md:flex-row items-end md:items-center gap-2 flex-1 justify-end">
          <button onClick={onToggleTopic} className="glass-btn-ghost px-3 py-2 text-xs font-bold md:hidden">
            {topicOpen ? '收起题目' : '查看题目'}
          </button>
          <button onClick={onSubmit} className="glass-btn-primary px-4 py-2 text-xs font-black">
            提交评估
          </button>
        </div>
      </div>

      {/* 四阶段 chips：当前阶段渐变描边 + 阶段色 glow，已完成打勾沉降 */}
      <div className="flex justify-center gap-1.5 md:gap-2 mt-2.5">
        {STAGES.map((s, i) => {
          const done = i < stageIdx;
          const current = i === stageIdx;
          return (
            <span
              key={s.id}
              className={`glass-chip px-2.5 py-1 text-[10px] md:text-[11px] ${done ? 'text-white/30' : current ? 'text-white' : 'text-white/50'}`}
              style={current ? { borderColor: `${s.color}80`, boxShadow: `0 0 12px ${s.color}55, inset 0 1px 0 rgba(255,255,255,0.12)` } : undefined}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: done ? 'rgba(255,255,255,0.25)' : s.color }} />
              {done ? `✓ ${s.short}` : s.short}
            </span>
          );
        })}
      </div>

      {degraded && (
        <div className="badge-warning rounded-xl px-3 py-1.5 text-[11px] mt-2">
          ⚠️ 部分能力降级中（LLM/语音异常已自动降级），讨论仍可继续
        </div>
      )}
    </div>
  );
};

export default ClassicPhaseHeader;
