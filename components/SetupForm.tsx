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
      alert("请填写公司和岗位");
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
      alert("生成失败，请重试");
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
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
      {/* 标题 */}
      <div className="bg-blue-600 px-8 py-6">
        <h1 className="text-2xl font-bold text-white text-center">开始练习</h1>
        <p className="text-blue-100 text-center text-sm mt-1">填写信息生成专属题目</p>
      </div>

      <form onSubmit={handleSubmit} className="p-8 space-y-6">
        {/* 公司输入 */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">目标公司</label>
          <input 
            type="text" 
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="如：字节跳动、腾讯、阿里"
            className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition"
            required
          />
        </div>

        {/* 岗位输入 */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">应聘岗位</label>
          <input 
            type="text" 
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="如：产品经理、运营专员"
            className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition"
            required
          />
        </div>

        {/* 生成按钮 */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || !company || !jobTitle}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
        >
          {isGenerating ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              生成中...
            </>
          ) : (
            "AI 生成题目"
          )}
        </button>

        {/* 题目显示 */}
        {topic && (
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">群面题目</label>
            <textarea 
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full h-48 px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition resize-none text-sm leading-relaxed"
              placeholder="生成的题目将显示在这里..."
            />
          </div>
        )}

        {/* 开始按钮 */}
        {topic && (
          <button 
            type="submit"
            className="w-full py-4 bg-slate-900 text-white rounded-lg font-bold hover:bg-slate-800 transition text-base"
          >
            开始模拟
          </button>
        )}
      </form>
    </div>
  );
};

export default SetupForm;
