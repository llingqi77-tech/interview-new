import React, { useEffect, useState } from 'react';
import SetupForm from './components/SetupForm';
import DeviceCheck, { type DeviceCheckResult } from './components/DeviceCheck';
import VoiceRoom from './components/VoiceRoom';
import EvidenceReport from './components/EvidenceReport';
import PrivacyPolicy from './components/PrivacyPolicy';
import PayModal from './components/PayModal';
import SettingsModal from './components/SettingsModal';
import WalletButton from './components/WalletButton';
import { useWalletIdentity } from './src/wallet/context';
import { SimulationState, InterviewFormat, Message, GameEvent, RoleCard, ReportV15, FeedbackData } from './types';
import { generateReportV15, generateFeedback } from './services/geminiService';
import {
  createSession,
  updateSessionStatus,
  deleteSession,
  saveReport,
  triggerAnalyze,
} from './src/api';

/**
 * 应用主流程（PRD 5.2 目标流程）
 * SetupForm → DeviceCheck → VoiceRoom（倒计时四阶段）→ EvidenceReport（v1.5）
 * 降级路径：无麦克风 → 纯文字；无摄像头 → 纯语音；弱网 → 纯语音/纯文字。
 */

const App: React.FC = () => {
  const [state, setState] = useState<SimulationState>({
    topic: '',
    jobTitle: '',
    company: '',
    status: 'IDLE',
  });
  const [roles, setRoles] = useState<RoleCard[]>([]);
  const [topicType, setTopicType] = useState('business_case');
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [consent, setConsent] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [dbAvailable, setDbAvailable] = useState(true);

  const [report, setReport] = useState<ReportV15 | null>(null);
  const [finishedMessages, setFinishedMessages] = useState<Message[]>([]);
  const [finishedEvents, setFinishedEvents] = useState<GameEvent[]>([]);
  const [sessionStartAt, setSessionStartAt] = useState(0);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // 导航吸顶：滚动后背景透明度 white/6 → white/10
  const [navScrolled, setNavScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // Q-N1：Para 钱包地址作为免登录用户标识（未配置 Para 时恒为匿名）
  const wallet = useWalletIdentity();

  // ---- 准备页 → 设备检测 ----
  const startPreparation = (params: {
    topic: string;
    jobTitle: string;
    company: string;
    topicType: string;
    format: InterviewFormat;
    roles: RoleCard[];
  }) => {
    setState((prev) => ({
      ...prev,
      topic: params.topic,
      jobTitle: params.jobTitle,
      company: params.company,
      format: params.format,
      status: 'PREPARING',
    }));
    setRoles(params.roles);
    setTopicType(params.topicType);
  };

  // ---- 设备检测完成 → 创建会话 → 进入房间 ----
  const enterRoom = async (result: DeviceCheckResult) => {
    setConsent(result.consentSaveTranscript);
    setCameraEnabled(result.cameraEnabled);
    setFacingMode(result.facingMode);

    // 创建会话（数据库不可用时降级本地模式）
    const session = await createSession({
      company: state.company,
      jobTitle: state.jobTitle,
      topic: state.topic,
      topicType,
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

  // ---- 群面结束 → 面后分析 → 报告 v1.5 ----
  const finishSimulation = async (
    history: Message[],
    events: GameEvent[],
    startedAt: number,
    visualRows: import('./types').VisualFeatureRow[] = []
  ) => {
    setState((prev) => ({ ...prev, status: 'FINISHED' }));
    setFinishedMessages(history);
    setFinishedEvents(events);
    setSessionStartAt(startedAt);
    setIsLoadingFeedback(true);
    setFeedbackError(false);

    const durationMs = Date.now() - startedAt;

    try {
      let reportV15: ReportV15 | null = null;
      if (sessionId && consent) {
        // 服务端分析：读 DB transcripts/events/visual_features → 规则引擎 + LLM → 已落库
        reportV15 = await triggerAnalyze(sessionId);
      }
      if (!reportV15) {
        // 客户端兜底（本地模式 / 服务端异常）：用会话内存数据生成，需手动落库
        reportV15 = await generateReportV15({
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
          saveReport({ sessionId, report: reportV15 });
        }
      }
      setReport(reportV15);
    } catch (e) {
      console.error('报告 v1.5 生成失败:', e);
      setFeedbackError(true);
    }

    // 更新会话状态
    if (sessionId) {
      updateSessionStatus(sessionId, 'FINISHED');
    }
    setIsLoadingFeedback(false);
  };

  /** 旧 4 字段报告（冗余展示）：EvidenceReport 内按需懒加载，不再随收尾无条件消耗一次 LLM 调用 */
  const loadLegacyFeedback = () => generateFeedback(state.topic, state.jobTitle, finishedMessages);

  const handleDeleteRecords = async (id: number): Promise<boolean> => {
    return deleteSession(id);
  };

  const restart = () => {
    // 中途退出房间：把会话收尾（否则库里永远留着 status='DISCUSSING' 的孤儿会话）
    if (sessionId && state.status === 'DISCUSSING') {
      void updateSessionStatus(sessionId, 'FINISHED');
    }
    setState({
      topic: '',
      jobTitle: '',
      company: '',
      status: 'IDLE',
    });
    setRoles([]);
    setSessionId(null);
    setReport(null);
    setFinishedMessages([]);
    setFinishedEvents([]);
  };

  return (
    <div className="min-h-screen">
      {/* 液态折射 SVG 位移滤镜（全页挂载一次，供 .liquid 引用） */}
      <svg aria-hidden="true" focusable="false" className="absolute w-0 h-0 overflow-hidden">
        <defs>
          <filter id="glass-distortion">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" />
            <feDisplacementMap in="SourceGraphic" scale="12" />
          </filter>
        </defs>
      </svg>

      {/* 背景系统：深色径向渐变 + 极光光斑（玻璃感的依托） */}
      <div className="aurora-stage" aria-hidden="true">
        <div className="aurora-blob aurora-blob-a" />
        <div className="aurora-blob aurora-blob-b" />
        <div className="aurora-blob aurora-blob-c" />
      </div>

      {/* 顶部导航：吸顶玻璃条 */}
      <div className={`glass-nav ${navScrolled ? 'glass-nav-scrolled' : ''} px-4 md:px-6 py-3`}>
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="text-lg font-bold text-gradient-brand tracking-tight">LGD Simulator</div>
          <div className="flex items-center gap-3 md:gap-4">
            {!dbAvailable && state.status !== 'IDLE' && (
              <span className="glass-chip badge-warning text-[10px] px-2 py-0.5">
                本地模式（未配置数据库）
              </span>
            )}
            <WalletButton />
            <button onClick={() => setShowPay(true)} className="glass-btn-primary text-sm px-3 py-1.5">
              购买次数
            </button>
            <button onClick={() => setShowSettings(true)} className="glass-btn-ghost text-sm px-3 py-1.5">
              配置
            </button>
            <button onClick={() => setShowPrivacy(true)} className="glass-btn-ghost text-sm px-3 py-1.5">
              隐私政策
            </button>
            <button onClick={restart} className="glass-btn-ghost text-sm px-3 py-1.5">
              新建练习
            </button>
          </div>
        </div>
      </div>

      {/* 吸顶导航占位（原导航在流内高度 57px） */}
      <div className="h-[57px]" aria-hidden="true" />

      {/* 主内容 */}
      <div className={state.status === 'DISCUSSING' ? 'h-[calc(100vh-57px)]' : 'p-4 md:p-6'}>
        {state.status === 'IDLE' && (
          <div className="max-w-3xl mx-auto">
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
            <VoiceRoom
              state={state}
              roles={roles}
              format={state.format}
              sessionId={sessionId}
              consentSaveTranscript={consent}
              cameraEnabled={cameraEnabled}
              facingMode={facingMode}
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
                  <div className="w-20 h-20 border-4 border-white/10 border-t-brand rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center text-gradient-brand font-bold">AI</div>
                </div>
                <div className="mt-6 text-center">
                  <h3 className="text-xl font-bold text-white">面试官正在整理评估报告...</h3>
                  <p className="text-white/60 mt-2">规则引擎实算指标 + AI 语义分析 + 证据池生成中（目标 ≤30 秒）</p>
                </div>
              </div>
            ) : report ? (
              <EvidenceReport
                report={report}
                loadLegacy={feedbackError ? undefined : loadLegacyFeedback}
                messages={finishedMessages}
                events={finishedEvents}
                sessionStartAt={sessionStartAt}
                sessionId={sessionId}
                onRestart={restart}
                onDeleteRecords={handleDeleteRecords}
              />
            ) : (
              <div className="text-center p-8 glass-panel">
                <h2 className="text-2xl font-bold text-red-300 mb-4">反馈生成失败</h2>
                <p className="text-white/60 mb-6">请检查网络后重试（LLM 服务异常时会自动降级）</p>
                <button onClick={restart} className="glass-btn px-6 py-2">
                  返回主页
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}

      {showSettings && <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />}

      {showPay && (
        <PayModal
          open={showPay}
          onClose={() => setShowPay(false)}
          walletAddress={wallet.address}
          sessionId={sessionId}
        />
      )}
    </div>
  );
};

export default App;
