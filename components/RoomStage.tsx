import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent, InterviewFormat, InterviewerCard, Message, RoleCard, SimulationState, VisualFeatureRow } from '../types';
import { useSession } from '../src/session/useSession';
import { buildRoomView } from '../engine/roomView';
import type { InputMode } from '../engine/inputMode';
import InterviewRoom from './InterviewRoom';

/**
 * 房间容器：把 SessionController 的快照派生成 InterviewRoom 的展示数据。
 * 组件本身不持有会话状态，只派发动作。
 */

export interface RoomStageProps {
  state: SimulationState;
  roles: RoleCard[];
  interviewers: InterviewerCard[];
  format: InterviewFormat;
  sessionId: number | null;
  consentSaveTranscript: boolean;
  cameraEnabled: boolean;
  facingMode: 'user' | 'environment';
  inputMode: InputMode;
  degradedReason?: string;
  /** 题目要点（群面来自题库/生成结果） */
  keyPoints?: string[];
  onFinish: (history: Message[], events: GameEvent[], sessionStartAt: number, visualRows?: VisualFeatureRow[]) => void;
  onExit: () => void;
}

const RoomStage: React.FC<RoomStageProps> = ({
  state,
  roles,
  interviewers,
  format,
  sessionId,
  consentSaveTranscript,
  cameraEnabled,
  facingMode,
  inputMode,
  degradedReason,
  keyPoints = [],
  onFinish,
  onExit,
}) => {
  const [textInputOpen, setTextInputOpen] = useState(inputMode === 'text');
  const [topicOpen, setTopicOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  /** ASR 最终转写去重标记：回调已写入的文本，stop 时不得再追加一遍 */
  const asrFinalRef = useRef('');

  const deps = useMemo(
    () => ({
      state,
      roles,
      sessionId,
      consentSaveTranscript,
      cameraEnabled,
      facingMode,
      format,
      keyPoints,
      onFinish,
    }),
    [state, roles, sessionId, consentSaveTranscript, cameraEnabled, facingMode, format, keyPoints, onFinish]
  );

  const { controller, snapshot } = useSession(deps);

  // 开场白：进入房间后由主持/主面试官播报一次（PRD 4.）
  useEffect(() => {
    controller.announceOpening();
  }, [controller]);

  /**
   * 语音输入主按钮（PRD 4. 输入方式降级链）
   * realtime → 直接抢话；asr → 按键说话；webspeech → 浏览器识别；text → 打开文字输入
   */
  const handleVoiceInput = async () => {
    if (inputMode === 'text') {
      setTextInputOpen(true);
      return;
    }
    if (listening) {
      const finalText = await controller.stopUserAsr();
      setListening(false);
      setPartial('');
      if (finalText && finalText !== asrFinalRef.current) controller.sendUserSpeech(finalText);
      return;
    }
    controller.bargeIn();
    asrFinalRef.current = '';
    setListening(true);
    await controller.startUserAsr(
      (text) => setPartial(text),
      (final) => {
        asrFinalRef.current = final;
        controller.sendUserSpeech(final);
      }
    );
  };

  const view = buildRoomView({
    format,
    phaseState: snapshot.phase,
    now: Date.now(),
    topic: state.topic,
    keyPoints,
    messages: snapshot.messages,
    roles,
    interviewers,
    speakingCharId: snapshot.speakingCharId,
    thinking: snapshot.isGenerating && !snapshot.streamingText,
    streaming: Boolean(snapshot.streamingText),
    inputMode,
    degraded: snapshot.degraded ? degradedReason ?? '语音服务异常，已切换为文字输入' : degradedReason ?? null,
    muted: !snapshot.micOn,
    cameraOn: snapshot.cameraOn,
    textInputOpen,
    canSkipAiIntro: format === 'lgd' && snapshot.phase.phaseIndex === 1,
  });

  return (
    <>
      <InterviewRoom
        {...view}
        onSend={(text) => controller.sendTextMessage(text)}
        onBargeIn={() => void handleVoiceInput()}
        onToggleMute={() => controller.toggleMic()}
        onToggleCamera={() => controller.toggleCamera()}
        onToggleTextInput={() => setTextInputOpen((v) => !v)}
        listening={listening}
        partialText={partial}
        onEnd={() => void controller.finishSession()}
        onViewTopic={() => setTopicOpen(true)}
        onSkipAiIntro={() => controller.skipAiIntro()}
      />
      {topicOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setTopicOpen(false)}>
          <div className="glass-panel max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-white mb-2">本场题目</h3>
            <p className="text-sm text-white/75 leading-relaxed whitespace-pre-wrap">{state.topic}</p>
            <button type="button" onClick={() => setTopicOpen(false)} className="glass-btn mt-4 px-4 py-2 text-sm">
              关闭
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default RoomStage;
