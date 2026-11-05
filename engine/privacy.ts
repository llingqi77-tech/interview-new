/**
 * 隐私与数据说明（PRD 9. 隐私与数据说明）
 * 单一事实来源：设备检测页的同意开关、隐私政策弹窗、报告页脚都读这里。
 */

export interface ThirdParty {
  name: string;
  scope: string;
  credential: string;
}

export const PRIVACY = {
  /** 收集什么 */
  collected: [
    '群面转写文本（需用户明确同意）',
    '聚合特征：发言时长、打断次数、话语权占比等统计指标',
  ],
  /** 不保存什么 */
  notSaved: ['原始音频默认不保存', '原始视频默认不保存'],
  /** 只在本地完成什么 */
  localOnly: ['摄像头画面分析全部在浏览器本地完成（0 字节上传）'],
  /** 第三方 API 分工 */
  thirdParties: [
    { name: 'DeepSeek', scope: '题目生成、角色发言、面后分析等文本任务', credential: 'API 密钥仅保存在服务端' },
    { name: 'StepFun', scope: 'TTS 语音合成、ASR 语音识别、Realtime 全双工语音', credential: '凭证由服务端短时签发' },
  ] as ThirdParty[],
  /** 用途 */
  purpose: ['仅用于生成本次面后评估报告', '产品改进分析'],
};

/** 设备检测页的数据同意开关条目 */
export const CONSENT_ITEMS = [
  '同意保存本次面试的转写文本与聚合特征，用于面后评估',
  '原始音频/视频默认不保存',
  '摄像头画面分析在浏览器本地完成，不上传',
];

export const CONSENT_SUMMARY = '同意保存本次面试的转写文本与聚合特征用于面后评估；原始音频/视频默认不保存。';
