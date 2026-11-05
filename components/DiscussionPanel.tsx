import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { GameEvent, InterviewFormat, Message, RoleCard, SimulationState } from '../types';
import { currentPhase } from '../engine/phaseEngine';
import { useSession } from '../src/session/useSession';
import { HOST_CARD } from '../data/interviewerCards';
import AvatarStage from './AvatarStage';
import ClassicPhaseHeader from './classic/ClassicPhaseHeader';
import ClassicAside from './classic/ClassicAside';
import MessageBubble from './classic/MessageBubble';

/**
 * 群面房间·经典模式（M7 Phase 1 重构：逻辑/副作用全部迁入 SessionController）
 * - 本组件只读 SessionStore 快照 + 派发动作；四阶段引擎/发言权调度/要点跟踪行为不变
 * - 会话逻辑见 src/session/sessionController.ts；引擎见 engine/phaseEngine.ts + engine/turnTaking.ts
 */

interface DiscussionPanelProps {
  state: SimulationState;
  roles: RoleCard[];
  format?: InterviewFormat;
  sessionId: number | null;
  consentSaveTranscript: boolean;
  cameraEnabled: boolean;
  facingMode: 'user' | 'environment';
  onFinish: (history: Message[], events: GameEvent[], sessionStartAt: number, visualRows?: import('../types').VisualFeatureRow[]) => void;
}

const DiscussionPanel: React.FC<DiscussionPanelProps> = ({
  state,
  roles,
  format = 'lgd' as InterviewFormat,
  sessionId,
  consentSaveTranscript,
  cameraEnabled,
  facingMode,
  onFinish,
}) => {
  const { controller, snapshot } = useSession({ state, roles, format, sessionId, consentSaveTranscript, cameraEnabled, facingMode, onFinish });
  const {
    messages,
    phase: phaseState,
    activeCharId,
    speakingCharId,
    streamingText,
    isGenerating,
    awaitingUser,
    degraded,
    currentKeyPoint,
    cameraOn,
    micOn,
  } = snapshot;
  const voiceCaps = snapshot.caps;
  const realtimeActive = snapshot.realtimeStatus === 'active';
  /** 展示用角色列表：lgd 阵型额外展示主持面试官（不参与发言权调度，仅展示/气泡头像） */
  // 展示用角色列表（memo：避免 nowTs/流式文本重渲染破坏 MessageBubble memo）
  const displayCards = useMemo(() => (format === 'panel' ? roles : [...roles, HOST_CARD]), [format, roles]);
  // 纯 UI 本地态（不进 SessionStore：文字草稿/PTT 录音指示/移动端折叠）
  const [inputValue, setInputValue] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [asrPartial, setAsrPartial] = useState('');
  const [topicOpen, setTopicOpen] = useState(true);
  const [textOpen, setTextOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** 最近一次由 ASR 回调交付的最终转写：stopAsr 也会返回同一段文本，据此避免重复写入输入框 */
  const asrFinalRef = useRef<string>('');
  // ---------- 滚动 ----------
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingText]);

  // ---------- 用户发言 ----------
  const handleSendMessage = () => {
    const text = inputValue.trim();
    if (!text) return;
    controller.sendTextMessage(text); // 内含 barge-in（TC-04）
    setInputValue('');
  };

  // ---------- PTT 语音输入（按键说话；Realtime 不可用时的降级链路） ----------
  const toggleListening = async () => {
    // 抢话：AI 播报中用户开始说话 → barge-in
    if (!isListening && (speakingCharId || isGenerating)) {
      controller.bargeIn();
    }
    if (isListening) {
      const finalText = await controller.stopUserAsr();
      setIsListening(false);
      setAsrPartial('');
      // ASR 回调已经把这句写进输入框时不再追加（否则同一条转写出现两遍）
      if (finalText && finalText !== asrFinalRef.current) {
        setInputValue((prev) => (prev ? `${prev}${finalText}` : finalText));
      }
      asrFinalRef.current = '';
      return;
    }
    setIsListening(true);
    await controller.startUserAsr(
      (partial) => setAsrPartial(partial),
      (final) => {
        asrFinalRef.current = final;
        setAsrPartial('');
        setInputValue((prev) => (prev ? `${prev}${final}` : final));
      }
    );
  };

  // ---------- 渲染 ----------
  const phase = currentPhase(phaseState, controller.format, controller.phaseConfig);
  // 文字输入面板可见性：手动展开 / 纯文字降级 / 已有草稿时自动展开
  const textVisible = textOpen || voiceCaps?.inputMode === 'text' || inputValue.length > 0;

  return (
    <div className="flex h-full overflow-hidden relative flex-col md:flex-row">
      {/* 主列（桌面 + 移动端共用） */}
      <div className="flex-1 flex flex-col min-w-0">
        <ClassicPhaseHeader
          phaseState={phaseState}
          phaseConfig={controller.phaseConfig}
          roles={displayCards}
          degraded={degraded}
          topicOpen={topicOpen}
          onToggleTopic={() => setTopicOpen((v) => !v)}
          onSubmit={() => void controller.finishSession()}
        />

        {/* 移动端：可折叠题目卡 */}
        {topicOpen && (
          <div className="md:hidden mx-3 mt-2 glass-panel p-3 max-h-40 overflow-y-auto glass-scroll">
            <div className="text-[11px] font-black text-white/80 uppercase tracking-widest mb-1">题目</div>
            <p className="text-[13px] text-white/70 leading-relaxed whitespace-pre-wrap">{state.topic}</p>
            {currentKeyPoint && <div className="mt-2 text-[11px] font-bold text-gradient-brand">当前要点：{currentKeyPoint}</div>}
          </div>
        )}

        {/* 形象台（移动端横向滑动；桌面见右侧栏） */}
        <div className="md:hidden px-3 pt-3">
          <AvatarStage
            cards={displayCards}
            activeCardId={activeCharId}
            speakingCardId={speakingCharId}
            cameraEnabled={cameraOn}
            facingMode={facingMode}
            micOn={micOn}
            userStream={controller.getUserStream()}
          />
        </div>

        {/* 发言区：玻璃气泡转写流（气泡不加 blur，控制同屏滤镜面数量） */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
          {phase.id === 'READING' && (
            <div className="text-center py-10">
              <div className="text-4xl mb-3">📖</div>
              <div className="text-lg font-bold text-white">审题阶段</div>
              <p className="text-sm text-white/50 mt-1">
                {format === 'panel'
                  ? '面试即将开始，倒计时结束后请先做自我介绍'
                  : '请阅读题目，倒计时结束后进入个人陈述（每人 1 分钟）'}
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} roles={displayCards} />
          ))}

          {isGenerating && streamingText && (
            <div className="flex justify-start fade-up">
              <div className="max-w-[80%] bg-white/[0.08] border border-white/15 rounded-2xl rounded-tl-none px-5 py-4">
                <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-white/90">{streamingText}</p>
                <span className="inline-block w-1.5 h-4 bg-brand animate-pulse ml-0.5" />
              </div>
            </div>
          )}

          {isGenerating && !streamingText && (
            <div className="flex justify-start">
              <div className="bg-white/[0.08] border border-white/15 rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="typing-indicator flex space-x-1 text-white/60">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <span className="text-[11px] font-bold text-white/40">思考中</span>
              </div>
            </div>
          )}

          {awaitingUser && (
            <div className="text-center">
              <span
                className="glass-chip px-4 py-2 text-xs font-bold text-white animate-pulse"
                style={{ background: 'rgb(91 108 255 / 0.15)', borderColor: 'rgb(91 108 255 / 0.40)' }}
              >
                🎤 轮到你发言（说点什么或输入文字）
              </span>
            </div>
          )}
        </div>

        {/* 发言轨迹：细玻璃条，用户品牌渐变条 / AI 白点，当前位置放大发光 */}
        {messages.length > 0 && (
          <div className="px-3 md:px-4 py-1.5 bg-white/[0.04] border-t border-white/10 flex items-center gap-2">
            <span className="text-[10px] text-white/40 font-bold shrink-0">发言轨迹</span>
            <div className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-hide">
              {messages.slice(-50).map((m, i, arr) => (
                <span
                  key={m.id}
                  title={`${m.senderName}：${m.content.slice(0, 30)}`}
                  className={`h-2 rounded-full shrink-0 transition-all ${
                    m.senderId === 'user' ? 'w-7 bg-gradient-to-r from-brand to-brand-soft' : 'w-3.5 bg-white/30'
                  } ${i === arr.length - 1 ? 'scale-y-150 shadow-[0_0_8px_rgba(91,108,255,0.8)]' : ''}`}
                />
              ))}
            </div>
            <span className="text-[10px] text-white/40 shrink-0 tabular-nums">共 {messages.length} 次发言</span>
          </div>
        )}

        {/* 底部：悬浮语音控制 dock（white/12 最高透明度级） */}
        <div className="px-3 md:px-4 pt-2 pb-3 md:pb-4">
          {textVisible && (
            <div className="glass-card max-w-3xl mx-auto mb-3 p-3">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={
                  voiceCaps?.inputMode === 'text'
                    ? '纯文字模式：输入你的观点...'
                    : isListening
                      ? asrPartial || '正在录音，再次点击麦克风结束...'
                      : '输入观点，或点击麦克风语音发言...'
                }
                className="w-full bg-transparent outline-none resize-none h-20 text-sm text-white placeholder:text-white/30 glass-scroll"
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-white/30">{isListening ? '录音中：说完点击主麦克风结束' : 'Enter 发送 · Shift+Enter 换行'}</span>
                <button onClick={handleSendMessage} disabled={!inputValue.trim()} className="glass-btn-primary px-5 py-2 text-sm font-bold">
                  发送
                </button>
              </div>
            </div>
          )}
          <div className="glass-dock rounded-full px-4 md:px-6 py-2.5 flex items-center justify-center gap-2 md:gap-3 w-max mx-auto">
            <button
              onClick={() => controller.toggleMic()}
              className={`glass-btn-ghost rounded-full w-10 h-10 p-0 ${micOn ? '' : 'text-red-300 border-red-400/40 bg-red-500/15'}`}
              title={micOn ? '静音' : '取消静音'}
            >
              {micOn ? '🎙️' : '🔇'}
            </button>
            <button
              onClick={() => controller.toggleCamera()}
              className="glass-btn-ghost rounded-full w-10 h-10 p-0"
              title={cameraOn ? '关闭摄像头' : '开启摄像头'}
            >
              {cameraOn ? '📷' : '📵'}
            </button>
            {/* 麦克风主按钮：Realtime 接管时常亮（全双工免按键）；PTT 时说话中红色脉冲环 */}
            <button
              onClick={toggleListening}
              disabled={voiceCaps?.inputMode === 'text' || realtimeActive}
              className={`relative rounded-full w-14 h-14 flex items-center justify-center ${
                realtimeActive
                  ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 shadow-[0_0_20px_rgba(52,211,153,0.35)]'
                  : isListening
                    ? 'bg-red-500/25 border border-red-400/50 text-red-200 shadow-[0_0_20px_rgba(248,113,113,0.45)]'
                    : 'glass-btn-primary'
              } disabled:opacity-30`}
              title={
                realtimeActive
                  ? '实时语音已开启（全双工免按键，直接说话即可）'
                  : voiceCaps?.inputMode === 'text'
                    ? '当前环境不支持语音输入'
                    : '语音输入'
              }
            >
              {(isListening || snapshot.userSpeaking) && <span className="absolute inset-0 rounded-full bg-red-400/40 animate-ping" aria-hidden="true" />}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 relative" viewBox="0 0 20 20" fill="currentColor">
                <path d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
              </svg>
            </button>
            {/* 打断（barge-in） */}
            <button
              onClick={() => controller.bargeIn()}
              disabled={!speakingCharId && !isGenerating}
              className="glass-btn-ghost rounded-full w-10 h-10 p-0"
              title="打断 AI 发言（barge-in）"
            >
              ✋
            </button>
            {/* 文字输入展开 */}
            <button
              onClick={() => setTextOpen((v) => !v)}
              className={`glass-btn-ghost rounded-full w-10 h-10 p-0 ${textVisible ? 'bg-white/15' : ''}`}
              title="文字输入"
            >
              ✎
            </button>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2 text-[10px] text-white/30">
            <span>
              语音输入：{realtimeActive ? 'StepFun Realtime 全双工' : voiceCaps?.inputMode === 'stepfun-asr' ? 'StepFun ASR（按键说话）' : voiceCaps?.inputMode === 'webspeech' ? '浏览器语音（兜底）' : '纯文字（降级）'}
              {' · '}
              语音输出：{realtimeActive ? '分角色 Realtime 音色' : voiceCaps?.outputMode === 'stepfun-tts' ? 'StepFun TTS' : voiceCaps?.outputMode === 'webspeech-tts' ? '浏览器语音（兜底）' : '纯文字（降级）'}
            </span>
            <span className="hidden md:inline">
              {format === 'panel' ? `结构化单面 · ${roles.length} 位面试官` : '无领导小组讨论 · 主持控场'}
              {' · '}
              发言权由调度器分配 · 倒计时到点强制切换阶段
            </span>
          </div>
          {snapshot.realtimeStatus === 'fallback' && (
            <div className="mt-1 text-center text-[10px] text-amber-300/80">实时语音不可用，已自动退回按键说话/文字输入</div>
          )}
          {voiceCaps?.note && (
            <div className="mt-1 text-center text-[10px] text-amber-300/80">{voiceCaps.note}</div>
          )}
        </div>
      </div>

      <ClassicAside
        topic={state.topic}
        currentKeyPoint={currentKeyPoint}
        roles={displayCards}
        speakingCharId={speakingCharId}
        activeCharId={activeCharId}
        awaitingUser={awaitingUser}
        isGenerating={isGenerating}
        format={format}
      />
    </div>
  );
};

export default DiscussionPanel;
