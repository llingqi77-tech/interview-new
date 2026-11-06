import React, { useEffect, useState } from 'react';
import SetupForm, { type SetupParams } from './components/SetupForm';
import DeviceCheck, { type DeviceCheckResult } from './components/DeviceCheck';
import RoomStage from './components/RoomStage';
import ReportView from './components/ReportView';
import PrivacyPolicy from './components/PrivacyPolicy';
import SettingsModal from './components/SettingsModal';
import WalletButton from './components/WalletButton';
import { useWalletIdentity } from './src/wallet/context';
import type { GameEvent, InterviewFormat, InterviewerCard, Message, RoleCard, SimulationState, VisualFeatureRow } from './types';
import { interviewerToRoleCard } from './engine/roster';
import type { InterviewReport } from './engine/reportEngine';
import { REPORT_LOADING_HINT, REPORT_LOADING_TEXT } from './engine/reportCopy';
import type { InputMode } from './engine/inputMode';
import { generateInterviewReport } from './services/geminiService';
import { createSession, updateSessionStatus, deleteSession, saveReport, triggerAnalyze } from './src/api';

/**
 * 应用主流程（PRD 1. 整体流程总览）
 * IDLE 练习配置 → PREPARING 设备检测 → DISCUSSING 面试房间 → FINISHED 面后报告
 * 降级路径：无麦克风 → 纯文字；无摄像头 → 纯语音；弱网 → 纯语音/纯文字。
 */

const App: React.FC = () => {
  const [state, setState] = useState<SimulationState>({
    topic: '',
    jobTitle: '',
    company: '',
    status: 'IDLE',
  });
  const [setup, setSetup] = useState<SetupParams | null>(null);
  const [roles, setRoles] = useState<RoleCard[]>([]);
  const [interviewers, setInterviewers] = useState<InterviewerCard[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [consent, setConsent] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [inputMode, setInputMode] = useState<InputMode>('realtime');
  const [degradedReason, setDegradedReason] = useState<string | undefined>(undefined);
  const [dbAvailable, setDbAvailable] = useState(true);

  const [report, setReport] = useState<InterviewReport | null>(null);
  const [finishedMessages, setFinishedMessages] = useState<Message[]>([]);
  const [finishedEvents, setFinishedEvents] = useState<GameEvent[]>([]);
  const [sessionStartAt, setSessionStartAt] = useState(0);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // 切换环节时回到顶部：否则上一页的滚动位置会让新页面标题钻到吸顶导航下面
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [state.status]);

  const wallet = useWalletIdentity();

  // ---- 练习配置 → 设备检测 ----
  const startPreparation = (params: SetupParams) => {
    setSetup(params);
    setRoles(params.format === 'lgd' ? params.roles : params.interviewers.map(interviewerToRoleCard));
    setInterviewers(params.format === 'panel' ? params.interviewers : []);
    setState((prev) => ({
      ...prev,
      topic: params.topic,
      jobTitle: params.jobTitle,
      company: params.company,
      format: params.format,
      status: 'PREPARING',
    }));
  };

  // ---- 设备检测完成 → 创建会话 → 进入房间 ----
  const enterRoom = async (result: DeviceCheckResult) => {
    setConsent(result.consentSaveTranscript);
    setCameraEnabled(result.cameraEnabled);
    setFacingMode(result.facingMode);
    setInputMode(result.inputMode ?? 'realtime');
    setDegradedReason(result.degradedReason);

    const session = await createSession({
      company: state.company,
      jobTitle: state.jobTitle,
      topic: state.topic,
      topicType: setup?.topicType ?? 'business_case',
      format: state.format,
      roles: roles.map((r) => r.id),
      voiceEnabled: result.voiceEnabled,
      cameraEnabled: result.cameraEnabled,
      walletAddress: wallet.address,
    });
    if (session) {
      setSessionId(session.id);
      setDbAvailable(true);
    } else {
      setSessionId(null);
      setDbAvailable(false);
    }
    setState((prev) => ({ ...prev, status: 'DISCUSSING' }));
  };

  // ---- 面试结束 → 面后分析 → 报告 ----
  const finishSimulation = async (
    history: Message[],
    events: GameEvent[],
    startedAt: number,
    visualRows: VisualFeatureRow[] = []
  ) => {
    setState((prev) => ({ ...prev, status: 'FINISHED' }));
    setFinishedMessages(history);
    setFinishedEvents(events);
    setSessionStartAt(startedAt);
    setIsLoadingFeedback(true);
    setFeedbackError(false);

    const durationMs = Date.now() - startedAt;

    try {
      let generated: InterviewReport | null = null;
      if (sessionId && consent) {
        generated = await triggerAnalyze(sessionId);
      }
      if (!generated) {
        generated = await generateInterviewReport({
          format: state.format,
          topic: state.topic,
          jobTitle: state.jobTitle,
          messages: history,
          events,
          sessionStartAt: startedAt,
          durationMs,
          visualRows,
          sessionId,
        });
        if (sessionId && consent) {
          void saveReport({ sessionId, report: generated });
        }
      }
      setReport(generated);
    } catch (e) {
      console.error('面后报告生成失败:', e);
      setFeedbackError(true);
    }

    if (sessionId) void updateSessionStatus(sessionId, 'FINISHED');
    setIsLoadingFeedback(false);
  };

  const handleDeleteRecords = async (id: number): Promise<boolean> => deleteSession(id);

  const restart = () => {
    if (sessionId && state.status === 'DISCUSSING') {
      void updateSessionStatus(sessionId, 'FINISHED');
    }
    setState({ topic: '', jobTitle: '', company: '', status: 'IDLE' });
    setSetup(null);
    setRoles([]);
    setInterviewers([]);
    setSessionId(null);
    setReport(null);
    setFinishedMessages([]);
    setFinishedEvents([]);
    setFeedbackError(false);
  };

  return (
    <div className="product-app min-h-screen" data-page={state.status}>
      {state.status !== 'DISCUSSING' && state.status !== 'FINISHED' ? (
      <div className="glass-nav px-4 md:px-6 py-3">
        <div className="max-w-6xl mx-auto flex flex-wrap justify-between items-center gap-2">
          <div className="text-base md:text-lg font-bold text-gradient-brand tracking-tight whitespace-nowrap shrink-0">
            LGD Simulator
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 md:gap-4 min-w-0">
            {!dbAvailable && state.status !== 'IDLE' && (
              <span className="glass-chip badge-warning text-xs px-2 py-0.5 whitespace-nowrap hidden sm:inline">
                本地模式（未配置数据库）
              </span>
            )}
            <WalletButton />
            <button
              onClick={() => setShowSettings(true)}
              className="glass-btn-ghost text-xs md:text-sm px-2 md:px-3 py-1.5 whitespace-nowrap"
            >
              配置
            </button>
            <button
              onClick={() => setShowPrivacy(true)}
              className="glass-btn-ghost text-xs md:text-sm px-2 md:px-3 py-1.5 whitespace-nowrap"
            >
              隐私政策
            </button>
            <button
              onClick={restart}
              className="glass-btn-ghost text-xs md:text-sm px-2 md:px-3 py-1.5 whitespace-nowrap"
            >
              新建练习
            </button>
          </div>
        </div>
      </div>

      ) : (
        <div className="home-control"><button type="button" onClick={restart} className="glass-btn-ghost">← 退回首页</button></div>
      )}

      <div
        className={state.status === 'DISCUSSING' ? 'product-content room-content' : 'product-content p-4 md:p-6'}
      >
        {state.status === 'IDLE' && (
          <div className="max-w-5xl mx-auto">
            <SetupForm onStart={startPreparation} />
          </div>
        )}

        {state.status === 'PREPARING' && (
          <div className="max-w-2xl mx-auto">
            <DeviceCheck onReady={enterRoom} onBack={restart} format={state.format} />
          </div>
        )}

        {state.status === 'DISCUSSING' && (
          <div className="max-w-7xl mx-auto h-full">
            <RoomStage
              state={state}
              roles={roles}
              interviewers={interviewers}
              format={state.format ?? 'lgd'}
              sessionId={sessionId}
              consentSaveTranscript={consent}
              cameraEnabled={cameraEnabled}
              facingMode={facingMode}
              inputMode={inputMode}
              degradedReason={dbAvailable ? degradedReason : [degradedReason, '本地模式（未配置数据库）'].filter(Boolean).join('；')}
              keyPoints={setup?.keyPoints ?? []}
              onFinish={finishSimulation}
              onExit={restart}
            />
          </div>
        )}

        {state.status === 'FINISHED' && (
          <div className="max-w-4xl mx-auto">
            {isLoadingFeedback ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="relative">
                  <div className="w-20 h-20 border-4 border-line border-t-brand rounded-full animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center text-gradient-brand font-bold">AI</div>
                </div>
                <div className="mt-6 text-center">
                  <h3 className="text-xl font-bold text-ink">{REPORT_LOADING_TEXT}</h3>
                  <p className="text-muted mt-2">{REPORT_LOADING_HINT}（目标 ≤20 秒）</p>
                </div>
              </div>
            ) : (
              <ReportView
                report={report}
                error={feedbackError ? '报告生成失败，请重试' : null}
                onRetry={() => void finishSimulation(finishedMessages, finishedEvents, sessionStartAt)}
                messages={finishedMessages}
                onRestart={restart}
                onDelete={() => {
                  if (sessionId) void handleDeleteRecords(sessionId);
                  restart();
                }}
              />
            )}
          </div>
        )}
      </div>

      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
      {showSettings && <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />}
    </div>
  );
};

export default App;
