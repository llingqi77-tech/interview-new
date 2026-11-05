import type { InterviewFormat, LgdTopicType } from '../types.ts';

/** 练习配置校验（PRD 2.：目标公司与应聘岗位必填） */

export interface SetupInput {
  company: string;
  jobTitle: string;
  format: InterviewFormat;
  topicType?: LgdTopicType;
  topic?: string;
  interviewerIds?: string[];
  panelSize?: number;
}

export interface SetupError {
  field: 'company' | 'jobTitle' | 'topic' | 'interviewerIds' | 'panelSize';
  message: string;
}

export function validateSetup(input: SetupInput): SetupError[] {
  const errors: SetupError[] = [];
  if (!input.company || !input.company.trim()) {
    errors.push({ field: 'company', message: '请填写目标公司' });
  }
  if (!input.jobTitle || !input.jobTitle.trim()) {
    errors.push({ field: 'jobTitle', message: '请填写应聘岗位' });
  }
  if (input.format === 'lgd') {
    if (input.topic !== undefined && !input.topic.trim()) {
      errors.push({ field: 'topic', message: '请先选择或生成讨论题目' });
    }
  } else {
    const size = input.panelSize ?? 2;
    if (size !== 2 && size !== 3) {
      errors.push({ field: 'panelSize', message: '面试官人数只能是 2 或 3 位' });
    }
    if (input.interviewerIds && input.interviewerIds.length !== size) {
      errors.push({ field: 'interviewerIds', message: `请选择 ${size} 位面试官` });
    }
  }
  return errors;
}

export function isSetupValid(input: SetupInput): boolean {
  return validateSetup(input).length === 0;
}
