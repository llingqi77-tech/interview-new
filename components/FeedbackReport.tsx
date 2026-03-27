
import React from 'react';
import { FeedbackData } from '../types';

interface FeedbackReportProps {
  feedback: FeedbackData;
  onRestart: () => void;
}

const FeedbackReport: React.FC<FeedbackReportProps> = ({ feedback, onRestart }) => {
  return (
    <div className="max-w-3xl mx-auto p-8 bg-white rounded-3xl shadow-2xl border border-blue-0">
      <div className="text-center mb-10">
        <div className="inline-block px-4 py-1 bg-blue-0 text-blue-00 rounded-full text-xs font-bold mb-4">模拟面试报告</div>
        <h2 className="text-4xl font-black text-slate-900 mb-4">面试表现评估</h2>
        <div className="flex justify-center items-center gap-4">
          <div className="flex flex-col items-center">
            <div className="text-5xl font-black text-blue-00">{feedback.overallScore}</div>
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">综合得分</div>
          </div>
          <div className="h-10 w-px bg-slate-200"></div>
          <div className="flex flex-col items-center">
            <div className="text-5xl font-black text-emerald-500">{feedback.voiceShare}%</div>
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">话语权占有</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
          <h3 className="text-sm font-bold text-slate-700 flex items-center mb-3">
            <span className="w-2 h-2 bg-blue-00 rounded-full mr-2"></span>
            发言时机
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed">{feedback.timing}</p>
        </div>
        
        <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
          <h3 className="text-sm font-bold text-slate-700 flex items-center mb-3">
            <span className="w-2 h-2 bg-blue-00 rounded-full mr-2"></span>
            结构贡献
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed">{feedback.structuralContribution}</p>
        </div>

        <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 md:col-span-2">
          <h3 className="text-sm font-bold text-slate-700 flex items-center mb-3">
            <span className="w-2 h-2 bg-blue-00 rounded-full mr-2"></span>
            抗压/冲突处理
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed">{feedback.interruptionHandling}</p>
        </div>
      </div>

      <div className="mb-10">
        <h3 className="text-lg font-bold text-slate-900 mb-4">改进建议</h3>
        <ul className="space-y-3">
          {feedback.suggestions.map((s, i) => (
            <li key={i} className="flex items-start gap-3 bg-blue-0/30 p-4 rounded-xl border border-blue-0">
              <span className="w-6 h-6 rounded-full bg-blue-00 text-blue-00 flex items-center justify-center text-xs font-bold shrink-0">{i+1}</span>
              <p className="text-sm text-slate-700 font-medium">{s}</p>
            </li>
          ))}
        </ul>
      </div>

      <button 
        onClick={onRestart}
        className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-100 active:scale-[0.98]"
      >
        重新开始模拟
      </button>
    </div>
  );
};

export default FeedbackReport;
