import type { InterviewFormat } from '../types.ts';

/** 面后报告文案（PRD 7. 面后报告） */

export const REPORT_LOADING_TEXT = '面试官正在整理评估报告…';
export const REPORT_LOADING_HINT = '规则引擎实算指标 + AI 语义分析 + 证据池生成';
/** 目标生成时长（PRD：目标 ≤20 秒） */
export const REPORT_TARGET_MS = 20000;
export const REPORT_TIMEOUT_MS = 30000;

/** 两种模式的考察核心（PRD 7.） */
export const CORE_FOCUS: Record<InterviewFormat, string> = {
  lgd: '考察核心：候选人在多人互动中的协作、影响与贡献能力——评价官关注你如何与他人共同推进讨论，而非单打独斗的个人表现。',
  panel: '考察核心：候选人的个人素质与目标岗位的匹配度——评价官关注你在结构化问答（含 STAR 行为面试与追问）中展现的知识、经验与潜力。',
};

export const REPORT_ACTIONS = {
  retry: '重试',
  home: '返回主页',
  restart: '再来一场',
  delete: '删除本次记录',
  deleteConfirm: '删除后不可恢复，确认删除本次记录？',
};

export const VISUAL_NOT_ENABLED_TEXT = '本场未开启';
