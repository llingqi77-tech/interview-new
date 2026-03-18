import React, { useState } from 'react';
import { generateTopicStream } from '../services/geminiService';

interface SetupFormProps {
  onStart: (topic: string, jobTitle: string, company: string) => void;
}

const SetupForm: React.FC<SetupFormProps> = ({ onStart }) => {
  const [topic, setTopic] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!company || !jobTitle) {
      alert("请先填写公司和岗位，以便生成相关的题目。");
      return;
    }
    setIsGenerating(true);
    setTopic("");
    try {
      const cleaned = await generateTopicStream(company, jobTitle, (chunk) =>
        setTopic((prev) => prev + chunk)
      );
      setTopic(cleaned);
    } catch (error) {
      console.error(error);
      alert("生成失败，请稍后重试。");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (topic && jobTitle && company) {
      onStart(topic, jobTitle, company);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 2rem)' }}>
      {/* 顶部：标题区域 - 商业化改版 */}
      <div className="flex-shrink-0 px-8 pt-8 pb-4 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900">
        <div className="text-center">
          {/* Logo + 品牌标识 */}
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </div>
            <span className="text-white font-bold text-lg tracking-wide">InterviewPro</span>
          </div>
          
          <h1 className="text-4xl font-black text-white mb-3 tracking-tight">
            群面模拟器
          </h1>
          <p className="text-slate-300 text-base font-medium max-w-xl mx-auto">
            AI 驱动的真实面试场景还原，助你在正式面试前发现短板，提升表现
          </p>
          
          {/* 统计数据展示 */}
          <div className="flex items-center justify-center gap-8 mt-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-white">10,000+</div>
              <div className="text-xs text-slate-400 uppercase tracking-wider">模拟次数</div>
            </div>
            <div className="w-px h-8 bg-slate-700"></div>
            <div className="text-center">
              <div className="text-2xl font-bold text-white">95%</div>
              <div className="text-xs text-slate-400 uppercase tracking-wider">用户满意度</div>
            </div>
            <div className="w-px h-8 bg-slate-700"></div>
            <div className="text-center">
              <div className="text-2xl font-bold text-white">500+</div>
              <div className="text-xs text-slate-400 uppercase tracking-wider">真实题库</div>
            </div>
          </div>
        </div>
      </div>

      {/* 功能特点标签 - 商业化新增 */}
      <div className="flex-shrink-0 px-8 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-center gap-6 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
          </svg>
          <span>AI 智能面试官</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
          </svg>
          <span>实时反馈分析</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
          </svg>
          <span>多角色模拟</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
          </svg>
          <span>精准能力评估</span>
        </div>
      </div>

      {/* 主要内容区域：左右布局 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：表单输入区域 */}
        <div className="w-96 flex-shrink-0 p-8 pt-6 flex flex-col">
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col space-y-5">
            <div className="space-y-5">
              <div className="group">
                <label className="block text-sm font-bold text-slate-700 mb-2 transition-colors group-focus-within:text-indigo-600">
                  目标公司
                  <span className="text-red-500 ml-1">*</span>
                </label>
                <input 
                  type="text" 
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="例如：字节跳动、腾讯、阿里"
                  className="w-full px-5 py-4 rounded-2xl border border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none transition-all text-slate-900 bg-white font-medium placeholder:text-slate-400 shadow-sm"
                  required
                />
              </div>
              <div className="group">
                <label className="block text-sm font-bold text-slate-700 mb-2 transition-colors group-focus-within:text-indigo-600">
                  面试岗位
                  <span className="text-red-500 ml-1">*</span>
                </label>
                <input 
                  type="text" 
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="例如：产品经理、算法工程师"
                  className="w-full px-5 py-4 rounded-2xl border border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none transition-all text-slate-900 bg-white font-medium placeholder:text-slate-400 shadow-sm"
                  required
                />
              </div>
            </div>
            
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || !company || !jobTitle}
              className="w-full px-5 py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl text-sm font-bold hover:from-indigo-700 hover:to-purple-700 shadow-lg shadow-indigo-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-indigo-600 disabled:hover:to-purple-600"
            >
              {isGenerating ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  AI 正在生成真题题目...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.3 1.047a1 1 0 01.894.448l7 11a1 1 0 11-1.688 1.06l-7-11a1 1 0 01.494-1.508zM1 18a1 1 0 011-1h16a1 1 0 110 2H2a1 1 0 01-1-1z" clipRule="evenodd" />
                    <path d="M5.5 13a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" />
                  </svg>
                  生成大厂真题风格题目
                </>
              )}
            </button>

            {/* 快速输入提示 */}
            <div className="text-xs text-slate-400 text-center">
              <span>支持公司：字节、阿里、腾讯、百度、京东等</span>
            </div>
          </form>
        </div>

        {/* 右侧：题目显示区域 */}
        <div className="flex-1 flex flex-col p-8 pt-6 overflow-hidden">
          <div className="mb-3 flex items-center justify-between">
            <label className="block text-sm font-bold text-slate-700">群面讨论题目</label>
            {topic && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
                ✓ 题目已生成
              </span>
            )}
          </div>
          
          <div className={`relative rounded-3xl overflow-hidden transition-all flex-1 flex flex-col ${topic ? 'bg-white shadow-inner border border-indigo-100' : 'bg-slate-50 border-2 border-dashed border-slate-200'}`}>
            <textarea 
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="点击左侧按钮，让 AI 结合目标公司与岗位，为你生成一道经典的群面真题...

或自行输入你准备面试的题目内容"
              className="w-full h-full px-6 py-6 text-slate-900 bg-transparent focus:outline-none transition-all resize-none text-base leading-relaxed font-medium placeholder:text-slate-400"
              required
            />
            {isGenerating && topic === "" && (
              <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
                  <span className="text-sm font-bold text-slate-600">AI 面试官出题中...</span>
                  <span className="text-xs text-slate-400">正在分析目标公司面试风格</span>
                </div>
              </div>
            )}
            {isGenerating && topic !== "" && (
              <div className="absolute bottom-4 right-4 flex items-center gap-2 text-xs text-indigo-600 font-medium">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                正在生成…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部：按钮和提示文字 */}
      <div className="flex-shrink-0 px-8 pb-8">
        <form onSubmit={handleSubmit}>
          <button 
            type="submit"
            disabled={!topic || !jobTitle || !company}
            className="w-full bg-gradient-to-r from-slate-900 to-slate-800 text-white font-bold py-4 rounded-2xl hover:from-indigo-600 hover:to-purple-600 shadow-lg shadow-slate-200 transition-all active:scale-[0.98] text-base tracking-wide uppercase disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:from-slate-900 disabled:hover:to-slate-800 flex items-center justify-center gap-3"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
            确认题目 · 开始模拟
          </button>
        </form>
        
        <p className="mt-4 text-center text-slate-400 text-xs">
          🔒 模拟过程完全私密，系统不会保存您的面试记录
        </p>
      </div>
    </div>
  );
};

export default SetupForm;
