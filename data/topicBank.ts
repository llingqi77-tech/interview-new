import type { LgdTopicType } from '../types.ts';

/**
 * 无领导小组讨论题库（PRD 2.：讨论会生成群面题目，手动预设好题库，从题库里调用）
 *
 * 题库是「AI 生成题目」的种子：点按钮时把选中题目的要点喂给 LLM 做改写/扩写，
 * 流式输出到可编辑文本框；不点按钮则直接用题库原文。
 */

export interface TopicEntry {
  id: string;
  type: LgdTopicType;
  title: string;
  /** 完整题面（展示 + 直接使用） */
  prompt: string;
  /** 讨论要点，喂给 LLM 与要点跟踪器 */
  keyPoints: string[];
}

export const TOPIC_BANK: Record<LgdTopicType, TopicEntry[]> = {
  business_case: [
    {
      id: 'bc-1',
      type: 'business_case',
      title: '新仓选址',
      prompt:
        '某快消公司计划新建一个区域仓，候选城市为 A、B、C 三地。A 地租金最低但距主要客户群 400 公里；B 地居中，租金中等，交通枢纽；C 地租金最高但紧邻最大客户。请小组讨论并给出选址方案，说明成本、时效、风险三方面的取舍。',
      keyPoints: ['成本结构', '配送时效', '风险与弹性', '最终方案与取舍理由'],
    },
    {
      id: 'bc-2',
      type: 'business_case',
      title: '会员体系改版',
      prompt:
        '某电商平台的会员体系连续两年亏损，付费会员续费率从 68% 降到 41%。公司给了你 500 万预算，要求 12 个月内把续费率拉回 60%。请讨论具体方案、资源分配与衡量指标。',
      keyPoints: ['续费率下滑归因', '权益设计', '预算分配', '衡量指标'],
    },
    {
      id: 'bc-3',
      type: 'business_case',
      title: '线下门店收缩',
      prompt:
        '某连锁品牌有 120 家门店，其中 37 家连续 6 个月亏损。管理层在「关店止损」与「改造升级」之间犹豫。请给出你的判断标准、处置方案与对员工和品牌的影响评估。',
      keyPoints: ['单店模型', '关店与改造的判断标准', '员工与品牌影响', '执行节奏'],
    },
  ],
  open_debate: [
    {
      id: 'od-1',
      type: 'open_debate',
      title: 'AI 是否应替代初级岗位',
      prompt:
        '正方：企业应尽快用 AI 替代初级岗位以提升效率。反方：企业应保留初级岗位并重构其职责。请小组先各自表明立场，再尝试形成一份兼顾效率与人才梯队的共识建议。',
      keyPoints: ['效率收益', '人才梯队', '岗位重构路径', '共识建议'],
    },
    {
      id: 'od-2',
      type: 'open_debate',
      title: '远程办公的边界',
      prompt:
        '某公司要求全员每周到岗 4 天，员工满意度下降 22%，但跨部门协作效率提升 15%。请讨论是否应维持该政策，并给出可执行的折中方案。',
      keyPoints: ['满意度与效率的权衡', '岗位差异', '折中方案', '落地风险'],
    },
    {
      id: 'od-3',
      type: 'open_debate',
      title: '数据变现的底线',
      prompt:
        '公司希望把脱敏后的用户行为数据对外售卖以开辟新收入。请讨论这件事该不该做、如果做需要哪些前置条件与红线。',
      keyPoints: ['合规红线', '用户信任', '收入测算', '前置条件'],
    },
  ],
  resource_scramble: [
    {
      id: 'rs-1',
      type: 'resource_scramble',
      title: '三个项目抢一个团队',
      prompt:
        '公司只有一个 8 人研发团队，同时有三个项目在排队：A 是监管合规改造（3 个月硬截止），B 是核心转化率优化（预期 +8% 收入），C 是新技术预研（无明确产出）。请讨论资源如何分配，并说明放弃项的善后。',
      keyPoints: ['优先级依据', '资源分配比例', '放弃项善后', '风险兜底'],
    },
    {
      id: 'rs-2',
      type: 'resource_scramble',
      title: '预算争夺',
      prompt:
        '市场部、产品部、客服部同时申请同一笔 300 万年度预算。市场部要投新渠道，产品部要做体验重构，客服部要上智能工单。请讨论分配方案与考核方式。',
      keyPoints: ['投入产出测算', '分配方案', '考核方式', '协同机制'],
    },
    {
      id: 'rs-3',
      type: 'resource_scramble',
      title: '旺季产能分配',
      prompt:
        '工厂旺季产能只能满足 70% 的订单。现有三类客户：长期大客户（毛利 18%）、新锐品牌（毛利 32%）、渠道散单（毛利 25%）。请讨论产能分配策略与客户沟通方案。',
      keyPoints: ['毛利与战略价值', '分配策略', '客户沟通', '长期影响'],
    },
  ],
  priority_rank: [
    {
      id: 'pr-1',
      type: 'priority_rank',
      title: '上线前的问题排序',
      prompt:
        '产品还有 7 天上线，当前有 6 个待办：支付偶发失败、首页加载慢 1.2 秒、帮助中心文案缺失、埋点不全、iOS 兼容问题、客服话术未培训。请排序并说明依据。',
      keyPoints: ['影响面与严重度', '排序依据', '上线门槛', '兜底方案'],
    },
    {
      id: 'pr-2',
      type: 'priority_rank',
      title: '新人培养优先级',
      prompt:
        '团队要给 5 位校招生安排培养资源，但导师只有 2 位。请按优先级排序并给出培养路径与衡量方式。',
      keyPoints: ['排序维度', '培养路径', '衡量方式', '导师负载'],
    },
    {
      id: 'pr-3',
      type: 'priority_rank',
      title: '客户投诉处理顺序',
      prompt:
        '客服同时收到 5 个投诉：大客户数据错误、媒体记者咨询、普通用户退款延迟、内部同事催单、监管问询。请排序并说明每一步的处理动作。',
      keyPoints: ['紧急与重要', '排序结果', '处理动作', '升级机制'],
    },
  ],
};

export const TOPIC_TYPE_LABELS: Record<LgdTopicType, string> = {
  business_case: '商业案例题',
  open_debate: '开放辩论题',
  resource_scramble: '资源争夺题',
  priority_rank: '优先级排序题',
};

/** 从题库取一条（seed 决定，可复现） */
export function pickTopic(type: LgdTopicType, seed = Date.now()): TopicEntry {
  const list = TOPIC_BANK[type] ?? TOPIC_BANK.business_case;
  const index = Math.abs(Math.floor(seed)) % list.length;
  return list[index];
}

export function topicCount(type: LgdTopicType): number {
  return (TOPIC_BANK[type] ?? []).length;
}
