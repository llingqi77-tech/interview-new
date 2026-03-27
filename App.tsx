import React, { useState, useEffect } from 'react';
import SetupForm from './components/SetupForm';
import DiscussionPanel from './components/DiscussionPanel';
import FeedbackReport from './components/FeedbackReport';
import { SimulationState, Message, FeedbackData } from './types';
import { generateFeedback } from './services/geminiService';

const App: React.FC = () => {
  const [state, setState] = useState<SimulationState>({
    topic: "",
    jobTitle: "",
    company: "",
    messages: [],
    status: 'IDLE',
    activeCharacterId: null,
    round: 0
  });

  const [feedback, setFeedback] = useState<FeedbackData | null>(null);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);
  // 无需登录，直接使用

  const startSimulation = (topic: string, jobTitle: string, company: string) => {
    setState({
      topic,
      jobTitle,
      company,
      status: 'DISCUSSING',
      messages: [],
      round: 0
    });
  };

  const finishSimulation = async (history: Message[]) => {
    setState(prev => ({ ...prev, status: 'FINISHED', messages: history }));
    setIsLoadingFeedback(true);
    try {
      const data = await generateFeedback(state.topic, state.jobTitle, history);
      setFeedback(data);
    } catch (e) {
      console.error(e);
      setFeedback({
        timing: "分析时遇到了一些问题",
        voiceShare: 0,
        structuralContribution: "无法评价",
        interruptionHandling: "无法评价",
        overallScore: 60,
        suggestions: ["重试"]
      });
    } finally {
      setIsLoadingFeedback(false);
    }
  };

  const restart = () => {
    setState({
      topic: "",
      jobTitle: "",
      company: "",
      messages: [],
      status: 'IDLE',
      activeCharacterId: null,
      round: 0
    });
    setFeedback(null);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 顶部导航 */}
      <div className="bg-white border-b border-slate-200 px-6 py-3">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="text-lg font-bold text-blue-600">LGD Simulator</div>
          <div className="flex items-center gap-4">
            <button onClick={restart} className="text-sm text-blue-600 hover:underline">新建练习</button>
          </div>
        </div>
      </div>

      {/* 主内容 */}
      <div className="p-6">
        {state.status === 'IDLE' && (
          <div className="max-w-2xl mx-auto">
            <SetupForm onStart={startSimulation} />
          </div>
        )}

        {state.status === 'DISCUSSING' && (
          <div className="max-w-6xl mx-auto h-[calc(100vh-120px)]">
            <DiscussionPanel state={state} onFinish={finishSimulation} />
          </div>
        )}

        {state.status === 'FINISHED' && (
          <div className="max-w-4xl mx-auto">
            {isLoadingFeedback ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="relative">
                  <div className="w-20 h-20 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center text-blue-600 font-bold">AI</div>
                </div>
                <div className="mt-6 text-center">
                  <h3 className="text-xl font-bold text-slate-800">面试官正在整理评估报告...</h3>
                  <p className="text-slate-500 mt-2">分析发言频率、逻辑结构、打断应对中</p>
                </div>
              </div>
            ) : feedback ? (
              <FeedbackReport feedback={feedback} onRestart={restart} />
            ) : (
              <div className="text-center p-8 bg-white rounded-3xl shadow-xl">
                 <h2 className="text-2xl font-bold text-red-500 mb-4">反馈生成失败</h2>
                 <button onClick={restart} className="px-6 py-2 bg-slate-900 text-white rounded-xl">返回主页</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
