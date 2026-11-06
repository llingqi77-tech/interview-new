import React from 'react';

/**
 * 隐私政策与用户同意文案（PRD 4.1.9 / I.2）
 * 说明数据用途、保存期限、第三方 API（DeepSeek / StepFun）数据处理。
 */

interface PrivacyPolicyProps {
  onClose: () => void;
}

const PrivacyPolicy: React.FC<PrivacyPolicyProps> = ({ onClose }) => {
  return (
    <div className="glass-modal-backdrop p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="隐私政策" className="glass-modal max-w-2xl w-full max-h-[80vh] overflow-y-auto glass-scroll p-8 relative" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label="关闭"
          className="glass-btn-ghost absolute top-4 right-4 w-9 h-9 rounded-full p-0 text-muted"
        >
          ✕
        </button>
        <h2 className="text-2xl font-bold text-ink mb-6">隐私政策与数据说明</h2>

        <section className="mb-6">
          <h3 className="font-bold text-ink mb-2">1. 我们收集什么</h3>
          <ul className="text-sm text-muted list-disc pl-5 space-y-1">
            <li>群面转写文本（你的发言与 AI 角色发言）——仅在你明确同意后保存。</li>
            <li>聚合特征（发言时长、打断次数、话语权占比等统计指标）。</li>
            <li><b className="text-ink">原始音频与视频默认不保存</b>；摄像头分析全部在浏览器本地完成，原始视频 0 字节上传。</li>
          </ul>
        </section>

        <section className="mb-6">
          <h3 className="font-bold text-ink mb-2">2. 数据用途</h3>
          <p className="text-sm text-muted">仅用于生成本次群面的面后评估报告与产品改进分析，不用于任何其他目的。</p>
        </section>

        <section className="mb-6">
          <h3 className="font-bold text-ink mb-2">3. 第三方 API 数据处理</h3>
          <ul className="text-sm text-muted list-disc pl-5 space-y-1">
            <li>
              <b className="text-ink">DeepSeek</b>：处理题目生成、角色发言与面后分析所需的文本内容（题目、对话历史）。
            </li>
            <li>
              <b className="text-ink">StepFun</b>：处理语音合成（TTS）与语音识别（ASR）所需的文本/音频片段；凭证由服务端短时签发。
            </li>
            <li>API 密钥仅保存在服务端，前端不持有任何密钥。</li>
          </ul>
        </section>

        <section className="mb-6">
          <h3 className="font-bold text-ink mb-2">4. 保存期限与删除</h3>
          <p className="text-sm text-muted">
            转写文本与聚合特征保存用于报告展示与历史对比；你可以在报告页点击「删除本次记录」<b className="text-ink">不可恢复地</b>删除本次会话的全部数据。
          </p>
        </section>

        <section className="mb-8">
          <h3 className="font-bold text-ink mb-2">5. 形象合规</h3>
          <p className="text-sm text-muted">所有 AI 形象均为风格化虚拟形象，不使用任何真实名人的肖像、姓名或声音克隆。</p>
        </section>

        <button onClick={onClose} className="glass-btn-primary w-full py-3 font-bold">
          我已了解
        </button>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
