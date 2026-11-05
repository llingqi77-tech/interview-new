import type { InterviewFormat, RoleCard } from '../../types';
import { cardDisplayRole } from '../../data/roleCards.ts';
import { USER_INFO } from '../../data/userInfo.ts';
import { extractKeyPoints } from '../../engine/keyPoints.ts';
import { guidesToNextKeyPoint, proposesSummary } from '../../engine/discourseSignals.ts';

/**
 * 服务端 Prompt 资产（PRD 附录 F.0）
 * 原 constants.ts SYSTEM_PROMPT_BASE 与 geminiService.ts 的动态上下文注入逻辑
 * 全部迁入 /api/llm 服务端，按 action 分发；语音化后追加 emotion / instruction
 * 输出要求（F.1）。前端不再持有任何 key 或 prompt 资产。
 */

export const SYSTEM_PROMPT_BASE = `
你现在正在参加一场【{jobTitle}】岗位的真实无领导小组讨论面试。
题目：{topic}
当前讨论阶段：{phase}

你是：{characterName}
性格与角色：{characterPersonality}

回复规则：
1. **绝对严禁使用 Markdown 格式**（不加粗、不使用列表符号、不使用代码块）。
2. **极简主义**：控制在 100 字以内，像真实人类在群面中发言一样简短有力，内容要简短且有效。
3. **阶段意识（核心要求，必须严格遵守）**：
   - **开局框架阶段**：
     * 发言的关键是提出整体分析框架，例如按照什么顺序来分析，以及进行时间分配，然后发表自己的观点
     * 如果前面有人已经提出框架，你可以在此基础上补充、细化或提出不同角度的框架
     * 这个阶段的核心任务是建立讨论的基础框架
     * **重要**：如果是第一个发言者，绝对不能使用"刚才"、"大家提到"、"前面说的"等表达，因为之前没有任何讨论内容
   - **深入讨论与方案贡献**：
     * 提出自己的观点，分析和评判其他人的观点，推进讨论
     * 必须针对具体问题提出建设性观点，推动整体方案向前发展
     * 可以质疑、补充、延伸他人的观点，但要提出自己的见解
     * 关注方案的可行性和完整性，为整体方案贡献具体内容
     * 针对其他人的观点进行分析和评判，选取合适的，去掉不合适的
   - **引导与总结陈词**：
     * 对观点进行整合，把深入讨论阶段讨论的内容梳理清楚，确保不遗漏重要细节
     * 如果是汇报者，要清晰有逻辑地汇报出来，用有条理的方式呈现讨论结果
     * 如果是枢纽型角色，在所有问题都讨论完后，主动引导大家进行总结，可以说"我们讨论得差不多了，现在需要有人来总结一下我们的讨论内容，谁愿意来汇报？"或类似的话
     * 如果是其他角色，在枢纽型引导总结后，可以自荐进行汇报，说"我来总结一下"或"我来汇报"等
     * 如果已经有人自荐汇报，其他角色可以确认共识，或提出总结的关键要点
   - **最后补充与面试收尾**：
     * 针对汇报者已汇报的内容，进行适当的补充，也可默认不补充，不再进行任何发言
     * 可以指出汇报中的遗漏点，或简洁认同
     * 引导面试结束，避免重复已经说过的内容
4. **发言风格（真实群面场景）**：
   - **避免固定句式**：不要总是用"我同意"、"我反对"、"我要补充"这种固定开头
   - **使用自然表达**：可以用"我认为"、"我还想到一点"、"我想补充一下"、"从另一个角度看"、"这里有个问题"等更自然的表达
   - **直接切入主题**：可以直接说观点，不需要每次都先表态再说话
   - **符合人设性格**：你的发言必须完全符合你的性格特点
5. **互动规则（核心要求，必须严格遵守）**：
   - **【核心要求】必须基于前述1-2个发言者的发言内容进行后续发言**：
     * 你的发言必须明确回应最近1-2个发言者的具体观点、逻辑或问题
     * 不能自说自话，不能脱离前述发言者的内容
     * 必须引用前述发言者的具体观点或内容，然后在此基础上提出自己的观点
   - **必须对上一个发言者（包括用户和其他AI）的发言做出回应**，不能自说自话
   - **绝对不能同意自己的观点**，只能对别人的观点表示同意、质疑、补充或延伸
   - 如果上一个发言者是你自己，你必须针对其他人的观点进行回应，或者提出新的角度
   - **【关键要求】必须回应用户（{userName}）的发言**：
     * 如果讨论历史中有用户（{userName}）的发言，你必须在他的发言基础上进行回应
     * 不能仅仅与其他AI角色互动，而忽略用户的发言
     * 如果上一个发言者是用户，你必须针对他的具体发言内容进行回应（同意并推进、质疑后提出观点、或补充）
     * 如果上一个发言者不是用户，但讨论历史中有用户的发言，你也要在回应中体现出对用户观点的关注和回应
     * **禁止**：三个AI角色之间互相同意和质疑，而完全忽略用户的发言
   - **【有效性要求】必须是有观点和内容的有效发言**：
     * 不能只是简单附和，必须提出具体的观点、分析或建议
     * 必须符合当前讨论阶段的特点
     * 必须推动讨论向前发展，不能重复已经说过的内容
     * 发言要有实质性内容，不能空洞无物
   - **综合考虑所有参与者的发言**：在发言时，不仅要回应上一个发言者，还要考虑讨论历史中其他所有角色的观点
   - **重要：不要用固定句式**：要有自己的评判标准
6. **针对性互动**：
   - 回应上一个发言者的逻辑、观点或问题，避免自说自话
   - 同时要综合考虑讨论历史中其他所有角色的观点
   - 在综合考虑的基础上进行分析，给出自己的观点和评判，而不是简单附和或列举
7. **身份沉浸**：不要提及"AI"、"面试官"、"Prompt"或"题目"。
`;

/** 角色卡 → prompt 用的性格描述（legacy 文案优先，F.0：不丢弃） */
export function personaDescription(card: RoleCard): string {
  if (card.persona.legacy_personality) return card.persona.legacy_personality;
  return `${card.persona.traits.join('、')}。发言风格：${card.persona.speaking_style}。冲突策略：${card.persona.conflict_strategy}。`;
}

export interface HistoryItem {
  senderId: string;
  senderName: string;
  content: string;
}

export interface ReplyPayload {
  /** 目标公司（单面即时出题用） */
  company?: string;
  /** 单面：候选人自我介绍原文（用于即时出题） */
  selfIntro?: string;
  /** 单面：当前提问面试官分工 */
  panelDuty?: 'lead' | 'support';
  card: RoleCard;
  topic: string;
  jobTitle: string;
  history: HistoryItem[];
  phase: string;
  summaryGuided?: boolean;
  summaryVolunteered?: boolean;
  currentKeyPoint?: string | null;
  keyPointDiscussionCount?: number;
  allKeyPointsDiscussed?: boolean;
  allKeyPoints?: string[];
  currentKeyPointIndex?: number;
  /** 语音版：要求输出 JSON（F.1） */
  voiceMode?: boolean;
  /** 当前阶段剩余毫秒（阶段紧急度提示） */
  phaseRemainingMs?: number;
  /** 发言者身份：candidate=群面候选人（默认）；host=主持面试官（阵型 A）；interviewer=单面面试官（阵型 B） */
  speakerKind?: 'candidate' | 'host' | 'interviewer';
}

/**
 * 角色发言 prompt（由原 geminiService.generateAIReply 的动态注入逻辑迁移）
 */
export function buildReplyPrompt(p: ReplyPayload): string {
  const { card, topic, jobTitle, history, phase } = p;
  const displayRole = cardDisplayRole(card);

  const extractFromTopic = (topicText: string): string[] => extractKeyPoints(topicText);
  const topicKeyPoints = extractFromTopic(topic);

  const effectiveKeyPoints = p.allKeyPoints && p.allKeyPoints.length > 0 ? p.allKeyPoints : topicKeyPoints;
  const effectiveCurrentKeyPoint =
    p.currentKeyPoint ||
    (effectiveKeyPoints.length > 0 && typeof p.currentKeyPointIndex === 'number' && p.currentKeyPointIndex < effectiveKeyPoints.length
      ? effectiveKeyPoints[p.currentKeyPointIndex]
      : null);
  const effectiveDiscussionCount = typeof p.keyPointDiscussionCount === 'number' ? p.keyPointDiscussionCount : 0;
  const effectiveAllKeyPointsDiscussed = typeof p.allKeyPointsDiscussed === 'boolean' ? p.allKeyPointsDiscussed : false;
  const effectiveCurrentKeyPointIndex = typeof p.currentKeyPointIndex === 'number' ? p.currentKeyPointIndex : 0;

  const recentHistory = history.slice(-10);
  const lastMessage = recentHistory[recentHistory.length - 1];
  const lastSpeaker = lastMessage ? lastMessage.senderName : '';
  const isLastSpeakerUser = lastMessage && lastMessage.senderId === 'user';
  const isLastSpeakerSelf = lastMessage && lastMessage.senderId === card.id;

  const allSpeakers = recentHistory.map((m) => ({ name: m.senderName, content: m.content, id: m.senderId }));
  const otherSpeakers = allSpeakers.filter((s) => s.id !== card.id && s.id !== 'user');
  const userSpeakers = allSpeakers.filter((s) => s.id === 'user');
  const allParticipants = [...new Set(allSpeakers.map((s) => s.name))];

  const nonSystemMessages = history;
  const isFirstSpeaker = nonSystemMessages.length === 0 || (nonSystemMessages.length === 1 && nonSystemMessages[0].senderId === card.id);
  const isEarlySpeaker = nonSystemMessages.length <= 2;

  let contextHint = '';
  const isOpeningPhase = phase.includes('开局框架');
  const isDeepPhase = phase.includes('深入讨论');
  const isSummaryPhase = phase.includes('总结') || phase.includes('收尾');
  const isStructuredRole = displayRole === 'STRUCTURED';

  let logicCheckHint = '';
  if (isFirstSpeaker || isEarlySpeaker) {
    logicCheckHint = `\n【重要逻辑检查】你是${isFirstSpeaker ? '第一个' : '前几个'}发言者，讨论历史中${isFirstSpeaker ? '没有任何' : '几乎没有'}之前的讨论内容。因此：
- **绝对禁止**使用"刚才"、"大家提到"、"前面说的"、"之前讨论的"等表达
- **绝对禁止**引用不存在的讨论内容
- 如果是第一个发言者，直接提出你的框架和观点，不要说"刚才"、"大家"等
- 如果是前几个发言者，只能引用确实存在的、在你之前发言者的内容`;
  }

  const hasSummaryGuidance = recentHistory.some((m) => proposesSummary(m.content));

  const hasTimeAllocation = recentHistory.some((m) => {
    const content = m.content;
    return (
      (content.includes('分钟') || content.includes('时间') || content.includes('分配')) &&
      (content.includes('讨论') || content.includes('分析') || content.includes('阅读') || content.includes('汇报'))
    );
  });

  const hasEvaluativeStatement = recentHistory.some((m) => {
    const evaluativePatterns = [
      /提到的.*都是.*好方向/,
      /提到的.*是.*好方向/,
      /说的.*都是.*好方向/,
      /说的.*是.*好方向/,
      /提到的.*都很好/,
      /说的.*都很好/,
      /提到的.*很好/,
      /说的.*很好/,
      /提到的.*是解决.*的好方向/,
      /说的.*是解决.*的好方向/,
    ];
    return evaluativePatterns.some((pattern) => pattern.test(m.content));
  });

  const hasTopicOrderMentioned = recentHistory.some((m) => {
    const content = m.content;
    return (
      (content.includes('按题目顺序') || content.includes('按题目') || content.includes('按顺序')) &&
      (content.includes('讨论') || content.includes('推进') || content.includes('进行'))
    );
  });

  const userHasSpecificContent = recentHistory.some((m) => {
    if (m.senderId !== 'user') return false;
    const content = m.content;
    return (
      (content.includes('路径') || content.includes('流程') || content.includes('步骤') || content.includes('框架') || content.includes('方案') || content.includes('策略')) &&
      content.length > 30
    );
  });

  const userSpecificMessage = recentHistory
    .slice()
    .reverse()
    .find((m) => {
      if (m.senderId !== 'user') return false;
      const content = m.content;
      return (
        (content.includes('路径') || content.includes('流程') || content.includes('步骤') || content.includes('框架') || content.includes('方案') || content.includes('策略')) &&
        content.length > 30
      );
    });

  const hasVolunteered = recentHistory.some(
    (m) => m.content.includes('我来总结') || m.content.includes('我来汇报') || m.content.includes('我来说') || m.content.includes('我来')
  );

  const hasGuidanceToNextPart = recentHistory.some((m) => guidesToNextKeyPoint(m.content));

  const guidanceMessage = recentHistory
    .slice()
    .reverse()
    .find((m) => {
      const content = m.content;
      return (
        (content.includes('接下来') || content.includes('现在') || content.includes('应该') || content.includes('进入')) &&
        (content.includes('讨论') || content.includes('规划') || content.includes('设计') || content.includes('分析') || content.includes('策略') || content.includes('方案') || content.includes('框架'))
      );
    });

  const lastTwoMessages = recentHistory.slice(-2);
  const lastTwoSpeakers = lastTwoMessages.map((m) => ({ name: m.senderName, content: m.content, id: m.senderId }));

  if (isLastSpeakerUser) {
    const userMessageContent = lastMessage ? lastMessage.content : '';
    const secondLastMessage = recentHistory.length >= 2 ? recentHistory[recentHistory.length - 2] : null;
    const secondLastSpeaker = secondLastMessage ? secondLastMessage.senderName : null;
    const secondLastContent = secondLastMessage ? secondLastMessage.content : null;

    const userHasPath = userMessageContent.includes('路径') || userMessageContent.includes('流程') || userMessageContent.includes('步骤');
    const userHasFramework = userMessageContent.includes('框架') || userMessageContent.includes('方案') || userMessageContent.includes('策略');
    const userHasSpecific = userHasPath || userHasFramework;

    let specificResponseHint = '';
    if (userHasSpecific) {
      if (userHasPath) {
        specificResponseHint = `\n【关键要求】用户提出了具体的决策路径："${userMessageContent}"。你必须针对这个路径进行回应：
- **不能只说"我赞同"**，必须针对这个路径进行分析、补充、细化或提出不同角度
- **必须给出实质性反馈**，例如：分析这个路径的合理性、补充遗漏的环节、提出优化建议、或从不同角度提出观点
- 这是群面讨论，你必须回应用户提出的具体路径，不能忽略或简单附和`;
      } else if (userHasFramework) {
        specificResponseHint = `\n【关键要求】用户提出了具体的框架/方案："${userMessageContent}"。你必须针对这个框架/方案进行回应：
- **不能只说"我赞同"**，必须针对这个框架/方案进行分析、补充、细化或提出不同角度
- **必须给出实质性反馈**，例如：分析这个框架的合理性、补充遗漏的要点、提出优化建议、或从不同角度提出观点
- 这是群面讨论，你必须回应用户提出的具体框架/方案，不能忽略或简单附和`;
      }
    }

    if (isOpeningPhase) {
      contextHint = `\n【核心要求】上一个发言者是用户（考生）${lastSpeaker}，他说了："${userMessageContent}"。${secondLastSpeaker ? `倒数第二个发言者是${secondLastSpeaker}，他说了："${secondLastContent}"。` : ''}当前是开局框架阶段。你必须基于前述1-2个发言者的具体内容进行回应：
${specificResponseHint}
- **必须引用前述发言者的具体观点**，不能自说自话
- 如果用户提出了框架，你可以在此基础上补充、细化或提出不同角度的框架
- 如果用户提出了观点，你可以同意并推进，或质疑后提出自己的框架思路
- ${secondLastSpeaker ? `同时要考虑${secondLastSpeaker}的观点，综合回应` : ''}
- 不能只说"我同意"，必须针对具体内容做出实质性回应，提出有观点和内容的有效发言
- 必须符合当前阶段（开局框架阶段）的特点
这是群面讨论，你必须回应用户的发言内容，不能忽略他。`;
    } else {
      contextHint = `\n【核心要求】上一个发言者是用户（考生）${lastSpeaker}，他说了："${userMessageContent}"。${secondLastSpeaker ? `倒数第二个发言者是${secondLastSpeaker}，他说了："${secondLastContent}"。` : ''}你必须基于前述1-2个发言者的具体内容进行回应：
${specificResponseHint}
- **必须引用前述发言者的具体观点**，不能自说自话
- **同意并推进**：如果你同意他的观点，要在此基础上推进讨论，提出下一步或延伸思考
- **质疑后提出观点**：如果你不同意或认为有问题，要明确指出问题所在，然后提出自己的观点
- **补充**：如果你认为他的观点不完整，要补充具体的细节或角度
- ${secondLastSpeaker ? `同时要考虑${secondLastSpeaker}的观点，综合回应` : ''}
- 不能只说"我同意"或"我反对"，必须针对具体内容做出实质性回应，提出有观点和内容的有效发言
- 必须符合当前阶段的特点
这是群面讨论，你必须回应用户的发言内容，不能忽略他。`;
    }
  } else if (isLastSpeakerSelf) {
    const secondLastMessage = recentHistory.length >= 2 ? recentHistory[recentHistory.length - 2] : null;
    const secondLastSpeaker = secondLastMessage ? secondLastMessage.senderName : null;
    const secondLastContent = secondLastMessage ? secondLastMessage.content : null;

    if (secondLastMessage) {
      contextHint = `\n【核心要求】上一个发言者是你自己，你不能同意自己的观点。你必须基于倒数第二个发言者${secondLastSpeaker}的发言内容进行回应："${secondLastContent}"。请针对他的具体观点进行回应，提出有观点和内容的有效发言，必须符合当前阶段的特点。`;
    } else {
      contextHint = `重要：上一个发言者是你自己，你不能同意自己的观点。请针对讨论中其他人的观点进行回应，或者提出新的角度。`;
    }
  } else if (lastSpeaker) {
    const secondLastMessage = recentHistory.length >= 2 ? recentHistory[recentHistory.length - 2] : null;
    const secondLastSpeaker = secondLastMessage ? secondLastMessage.senderName : null;
    const secondLastContent = secondLastMessage ? secondLastMessage.content : null;

    if (isOpeningPhase) {
      contextHint = `\n【核心要求】上一个发言者是${lastSpeaker}，他说了："${lastMessage.content}"。${secondLastSpeaker ? `倒数第二个发言者是${secondLastSpeaker}，他说了："${secondLastContent}"。` : ''}当前是开局框架阶段。你必须基于前述1-2个发言者的具体内容进行回应：
- **必须引用前述发言者的具体观点**，不能自说自话
- 不能只说"我同意"，要在此基础上提出框架思路、补充框架要点或提出不同角度的框架
- ${secondLastSpeaker ? `同时要考虑${secondLastSpeaker}的观点，综合回应` : ''}
- 必须提出有观点和内容的有效发言，符合当前阶段（开局框架阶段）的特点`;
    } else {
      contextHint = `\n【核心要求】上一个发言者是${lastSpeaker}，他说了："${lastMessage.content}"。${secondLastSpeaker ? `倒数第二个发言者是${secondLastSpeaker}，他说了："${secondLastContent}"。` : ''}你必须基于前述1-2个发言者的具体内容进行回应：
- **必须引用前述发言者的具体观点**，不能自说自话
- 请对他的发言做出回应，但要提出自己的见解
- ${secondLastSpeaker ? `同时要考虑${secondLastSpeaker}的观点，综合回应` : ''}
- 必须提出有观点和内容的有效发言，符合当前阶段的特点`;
    }
  }

  let guidanceHint = '';
  if (hasGuidanceToNextPart && guidanceMessage) {
    const guidanceContent = guidanceMessage.content;
    let nextPart = '';
    for (const keyPoint of topicKeyPoints) {
      if (guidanceContent.includes(keyPoint)) {
        nextPart = keyPoint;
        break;
      }
    }
    if (!nextPart && topicKeyPoints.length > 0) {
      for (const keyPoint of topicKeyPoints) {
        const keyWords = keyPoint.split(/[与和、，,]/).map((w) => w.trim()).filter((w) => w.length > 1);
        for (const word of keyWords) {
          if (guidanceContent.includes(word)) {
            nextPart = keyPoint;
            break;
          }
        }
        if (nextPart) break;
      }
    }
    if (nextPart) {
      guidanceHint = `\n【重要】前面的发言者（${guidanceMessage.senderName}）已经引导到"${nextPart}"的讨论，并进行了总结。你不需要：
- 重复总结前面的内容（如"我们已经明确了..."、"刚才的思路很清晰"等）
- 重复引导性话语（如"接下来我们应该..."、"现在进入..."等）
- 重复评价性话语（如"XXX的思路很清晰"等）
你应该直接针对"${nextPart}"的具体内容进行发言，提出自己的观点、建议或补充，直接切入主题。`;
    } else {
      guidanceHint = `\n【重要】前面的发言者（${guidanceMessage.senderName}）已经引导到下一部分的讨论。你不需要重复引导和总结性话语，应该直接进入该部分的讨论，提出具体的观点和建议。`;
    }
  }

  const styleHint = `
发言风格要求：
- **避免固定句式**：不要总是用"我同意XXX的观点"、"我反对XXX"、"我要补充XXX"这种固定开头
- **使用自然表达**：可以直接说"我也赞同，我补充一点..."、"我认为..."、"从另一个角度看..."、"这里有个问题..."等
- **可以直接说观点**：不需要每次都先表态，可以直接切入主题
- **禁止重复内容**：前述发言人已经说过的内容，你不能重复。你的发言中不能有连续的10个字与前述发言者完全一样。这适用于所有AI角色，必须严格遵守
- **特别禁止重复固定表达**：不能重复相同的表达，如"我赞同按题目顺序"、"按题目顺序推进"等
- **特别禁止重复评价性语句**：不能重复相同的评价性语句，如"XXX提到的XXX确实是核心痛点"、"XXX的思路很清晰"等
- **【关键禁止】禁止重复评价性句式**：如果前面已经有人说过类似"XXX提到的XXX，都是/是XXX的好方向"这种评价性句式，你不能再重复这种句式
- **避免重复引导和总结**：如果前面已经有人引导到下一部分/阶段并进行了总结，你应该直接进入该部分的讨论
- **必须针对用户的具体内容进行回应**：如果用户提出了具体的决策路径、框架或方案，你不能只说"我赞同"，必须针对这个具体内容进行分析、补充、细化或提出不同角度，给出实质性反馈
- **内容简短有效**：控制在100字以内，内容要简短且有效，不要冗长
- 在综合考虑他人观点的基础上，要有自己的分析和评判标准，且不能偏离题目的核心
- 必须基本符合你的性格特点：${personaDescription(card)}
`;

  const hasUserInHistory = recentHistory.some((m) => m.senderId === 'user');
  const userMessages = recentHistory.filter((m) => m.senderId === 'user');

  let comprehensiveInteractionHint = '';
  if (allParticipants.length > 1) {
    const otherParticipants = allParticipants.filter((name) => name !== card.name.split(' (')[0]);
    const participantList = otherParticipants.join('、');
    const hasUserParticipant = allParticipants.some((name) => name === USER_INFO.name || name === USER_INFO.displayName);

    comprehensiveInteractionHint = `\n【重要】这是小组讨论，讨论历史中包含了以下参与者的发言：${participantList}。你在发言时：
- **必须回应前述发言者**，这是基本要求
- **同时要综合考虑其他所有参与者的观点**，体现出你在认真倾听所有人的发言
- **关键：不要用固定句式**：不要总是说"我同意XXX，也同意XXX的观点"这种固定句式
- **要有自己的分析和评判**：在综合考虑前述人的发言基础上，进行分析并给出自己的观点，要有自己的评判标准
- 可以自然地引用其他角色的观点作为分析的基础，例如"刚才${otherParticipants[0] || 'XX'}提到的...让我想到...，还有${otherParticipants[1] || 'XX'}说的...，从我的角度看..."，然后给出自己的分析和判断
- 要有自己的评判标准，对不同的观点进行分析、比较、筛选，然后提出自己的见解
- 让讨论更有互动性，不要只关注一个人，要体现出对整体讨论的关注
${hasUserParticipant ? `- **【关键】讨论历史中有用户（${USER_INFO.name}）的发言，你必须体现出对他的关注和回应，不能仅仅与其他AI角色互动**` : ''}`;
  }

  let userInteractionHint = '';
  if (hasUserInHistory) {
    const userMessageContents = userMessages.map((m) => m.content).join('；');
    const userHasSpecific = userMessages.some((m) => {
      const content = m.content;
      return (
        (content.includes('路径') || content.includes('流程') || content.includes('步骤') || content.includes('框架') || content.includes('方案') || content.includes('策略')) &&
        content.length > 30
      );
    });
    const userSpecificMsg = userMessages.find((m) => {
      const content = m.content;
      return (
        (content.includes('路径') || content.includes('流程') || content.includes('步骤') || content.includes('框架') || content.includes('方案') || content.includes('策略')) &&
        content.length > 30
      );
    });

    if (isLastSpeakerUser) {
      let specificHint = '';
      if (userHasSpecific && userSpecificMsg) {
        if (userSpecificMsg.content.includes('路径')) {
          specificHint = `\n【关键要求】用户提出了具体的决策路径："${userSpecificMsg.content}"。你必须针对这个路径进行回应：
- **不能只说"我赞同"**，必须针对这个路径进行分析、补充、细化或提出不同角度
- **必须给出实质性反馈**，例如：分析这个路径的合理性、补充遗漏的环节、提出优化建议、或从不同角度提出观点`;
        } else if (userSpecificMsg.content.includes('框架') || userSpecificMsg.content.includes('方案')) {
          specificHint = `\n【关键要求】用户提出了具体的框架/方案："${userSpecificMsg.content}"。你必须针对这个框架/方案进行回应：
- **不能只说"我赞同"**，必须针对这个框架/方案进行分析、补充、细化或提出不同角度
- **必须给出实质性反馈**，例如：分析这个框架的合理性、补充遗漏的要点、提出优化建议、或从不同角度提出观点`;
        }
      }
      userInteractionHint = `\n【核心要求】上一个发言者是用户（考生）${USER_INFO.name}，他说了："${userMessageContents}"。你必须针对他的具体发言内容进行回应：
${specificHint}
- **同意并推进**：如果你同意他的观点，要在此基础上推进讨论，提出下一步或延伸思考
- **质疑后提出观点**：如果你不同意或认为有问题，要明确指出问题所在，然后提出自己的观点
- **补充**：如果你认为他的观点不完整，要补充具体的细节或角度
- 不能只说"我同意"或"我反对"，必须针对他的具体内容做出实质性回应
- 这是群面讨论，你必须回应用户的发言内容，不能忽略他。`;
    } else {
      let specificHint = '';
      if (userHasSpecific && userSpecificMsg) {
        specificHint = `\n【特别提醒】用户提出了具体的${userSpecificMsg.content.includes('路径') ? '决策路径' : '框架/方案'}："${userSpecificMsg.content}"。即使上一个发言者不是用户，你也应该在回应中体现出对这个具体内容的关注和反馈，不能忽略。`;
      }
      userInteractionHint = `\n【关键要求】讨论历史中包含用户（考生）${USER_INFO.name}的发言："${userMessageContents}"。即使上一个发言者不是用户，你也必须：
${specificHint}
- **在回应中体现出对用户观点的关注和回应**，不能仅仅与其他AI角色互动
- **禁止**：三个AI角色之间互相同意和质疑，而完全忽略用户的发言
- 这是群面讨论，所有参与者都应该互相回应，**特别是要回应用户的发言**
- 你可以在回应上一个发言者的同时，自然地引用用户的观点，例如"刚才${USER_INFO.name}提到的...，结合上一个发言者的观点，我认为..."，然后给出自己的分析和判断`;
    }
  }

  let phaseSpecificHint = '';
  if (isOpeningPhase) {
    let timeAllocationHint = '';
    if (hasTimeAllocation) {
      timeAllocationHint = `\n【重要】前面已经有人提出了时间分配方案，你不需要再提出时间分配。你应该直接提出分析框架和观点，或者对已有的框架进行补充和细化。`;
    } else {
      timeAllocationHint = `\n【可选】如果还没有人提出时间分配，你可以提出时间分配方案。但这不是必须的，你也可以直接提出分析框架和观点。`;
    }
    let topicOrderHint = '';
    if (hasTopicOrderMentioned) {
      topicOrderHint = `\n【禁止重复】前面已经有人说过"按题目顺序"、"按题目顺序讨论"等表达，你不需要再重复这个表达。你应该直接提出分析框架和观点，或者对已有的框架进行补充和细化。`;
    }
    let userContentHint = '';
    if (userHasSpecificContent && userSpecificMessage) {
      userContentHint = `\n【关键要求】用户（${userSpecificMessage.senderName}）提出了具体的${userSpecificMessage.content.includes('路径') ? '决策路径' : userSpecificMessage.content.includes('框架') ? '分析框架' : '方案'}："${userSpecificMessage.content}"。你必须针对这个具体内容进行回应：
- **不能只说"我赞同"**，必须针对用户提出的具体内容进行分析、补充、细化或提出不同角度
- **必须给出实质性反馈**，例如：分析这个路径/框架的合理性、补充遗漏的环节、提出优化建议、或从不同角度提出观点
- 这是群面讨论，你必须回应用户提出的具体内容，不能忽略或简单附和`;
    }
    let evaluativeStatementHint = '';
    if (hasEvaluativeStatement) {
      evaluativeStatementHint = `\n【禁止重复评价】前面已经有人说过类似"XXX提到的XXX，都是/是XXX的好方向"这种评价性句式，你不能再重复这种句式。你应该直接提出自己的观点和建议，不要重复相同的评价性表达。`;
    }
    phaseSpecificHint = `\n【阶段要求：开局框架阶段 - 必须严格遵守】
- **发言的关键是提出整体分析框架**，例如按照什么顺序来分析，然后发表自己的观点
${timeAllocationHint}
${topicOrderHint}
${userContentHint}
${evaluativeStatementHint}
- 如果前面有人已经提出框架，你可以在此基础上补充、细化或提出不同角度的框架
- **这个阶段的核心任务是建立讨论的基础框架**
- **重要**：如果是第一个发言者，绝对不能使用"刚才"、"大家提到"、"前面说的"等表达，因为之前没有任何讨论内容
- 你的发言必须符合开局框架阶段的特点，不能偏离到其他阶段的内容`;
  } else if (isDeepPhase) {
    let evaluativeStatementHint = '';
    if (hasEvaluativeStatement) {
      evaluativeStatementHint = `\n【禁止重复评价】前面已经有人说过类似"XXX提到的XXX，都是/是XXX的好方向"这种评价性句式，你不能再重复这种句式。你应该直接提出自己的观点和建议，不要重复相同的评价性表达。`;
    }
    let keyPointControlHint = '';
    if (effectiveKeyPoints.length > 0) {
      if (effectiveAllKeyPointsDiscussed) {
        keyPointControlHint = `\n【核心要点讨论状态】所有核心要点（${effectiveKeyPoints.join('、')}）都已经讨论完毕。现在可以引导大家进行总结，或者对讨论内容进行整合。`;
      } else if (effectiveCurrentKeyPoint) {
        const remainingCount = 10 - effectiveDiscussionCount;
        if (remainingCount <= 0) {
          const nextKeyPointIndex = effectiveCurrentKeyPointIndex + 1;
          if (nextKeyPointIndex < effectiveKeyPoints.length) {
            keyPointControlHint = `\n【核心要点讨论状态】当前要点"${effectiveCurrentKeyPoint}"的讨论次数已达上限（10次）。你需要引导大家进入下一个要点"${effectiveKeyPoints[nextKeyPointIndex]}"的讨论。可以说"关于${effectiveCurrentKeyPoint}我们已经讨论得差不多了，接下来我们讨论${effectiveKeyPoints[nextKeyPointIndex]}"或类似的话。`;
          } else {
            keyPointControlHint = `\n【核心要点讨论状态】当前要点"${effectiveCurrentKeyPoint}"的讨论次数已达上限（10次）。这是最后一个要点，讨论完后可以引导大家进行总结。`;
          }
        } else {
          keyPointControlHint = `\n【核心要点讨论状态】当前正在讨论要点"${effectiveCurrentKeyPoint}"（已讨论${effectiveDiscussionCount}次，最多10次）。请继续针对这个要点提出观点和建议。`;
        }
      } else if (effectiveCurrentKeyPointIndex < effectiveKeyPoints.length) {
        keyPointControlHint = `\n【核心要点讨论状态】需要开始讨论要点"${effectiveKeyPoints[effectiveCurrentKeyPointIndex]}"。请针对这个要点提出观点和建议。`;
      }
    }
    phaseSpecificHint = `\n【阶段要求：深入讨论与方案贡献 - 必须严格遵守】
- **提出自己的观点**，分析和评判其他人的观点，推进讨论
- **必须针对具体问题提出建设性观点**，推动整体方案向前发展
- 可以质疑、补充、延伸他人的观点，但要提出自己的见解
- **关注方案的可行性和完整性**，为整体方案贡献具体内容
- **针对其他人的观点进行分析和评判**，选取合适的，去掉不合适的
${evaluativeStatementHint}
${keyPointControlHint}
- 你的发言必须符合深入讨论与方案贡献阶段的特点，不能偏离到其他阶段的内容`;
  } else if (isSummaryPhase) {
    let summaryControlHint = '';
    if (effectiveKeyPoints.length > 0 && !effectiveAllKeyPointsDiscussed) {
      const remainingKeyPoints = effectiveKeyPoints.slice(effectiveCurrentKeyPointIndex);
      summaryControlHint = `\n【重要限制】核心要点还没有全部讨论完。还有以下要点需要讨论：${remainingKeyPoints.join('、')}。你不能引导总结，应该继续讨论这些要点。`;
    }
    if (isStructuredRole && !hasSummaryGuidance) {
      if (effectiveAllKeyPointsDiscussed || effectiveKeyPoints.length === 0) {
        phaseSpecificHint = `\n【阶段要求：引导与总结陈词 - 必须严格遵守】
- **你是枢纽型角色**，在所有问题都讨论完后，主动引导大家进行总结
- 可以说"我们讨论得差不多了，现在需要有人来总结一下我们的讨论内容，谁愿意来汇报？"或类似的话
- **对观点进行整合**，把深入讨论阶段讨论的内容梳理清楚，确保不遗漏重要细节
- 你的发言必须符合引导与总结陈词阶段的特点`;
      } else {
        phaseSpecificHint = `\n【阶段要求：引导与总结陈词 - 必须严格遵守】
${summaryControlHint}
- **你是枢纽型角色**，但核心要点还没有全部讨论完，不能引导总结
- 应该继续讨论剩余的要点，或者引导大家进入下一个要点的讨论
- 你的发言必须符合当前阶段的特点`;
      }
    } else if (hasSummaryGuidance && !hasVolunteered && !p.summaryVolunteered) {
      phaseSpecificHint = `\n【阶段要求：引导与总结陈词 - 必须严格遵守】
- **已经有人引导总结**，但还没有人自荐汇报
- 你可以自荐进行汇报，说"我来总结一下"或"我来汇报"等
- **如果自荐，你需要对前述整体的讨论内容进行总结**，并用有条理的方式呈现和表述出来
- **对观点进行整合**，把深入讨论阶段讨论的内容梳理清楚，确保不遗漏重要细节
- 如果是汇报者，要清晰有逻辑地汇报出来，用有条理的方式呈现讨论结果
- 你的发言必须符合引导与总结陈词阶段的特点`;
    } else if (hasVolunteered || p.summaryVolunteered) {
      phaseSpecificHint = `\n【阶段要求：引导与总结陈词 - 必须严格遵守】
- **已经有人自荐进行总结汇报**
- 你可以对总结进行补充，指出遗漏的重要细节，或者简洁地表示同意
- **避免重复已经说过的内容**
- **对观点进行整合**，把深入讨论阶段讨论的内容梳理清楚，确保不遗漏重要细节
- 如果已经有人自荐汇报，其他角色可以确认共识，或提出总结的关键要点
- 你的发言必须符合引导与总结陈词阶段的特点`;
    } else {
      phaseSpecificHint = `\n【阶段要求：引导与总结陈词 - 必须严格遵守】
- **对观点进行整合**，把深入讨论阶段讨论的内容梳理清楚，确保不遗漏重要细节
- 如果是汇报者，要清晰有逻辑地汇报出来，用有条理的方式呈现讨论结果
- 你的发言必须符合引导与总结陈词阶段的特点`;
    }
  } else {
    phaseSpecificHint = `\n【阶段要求：最后补充与面试收尾 - 必须严格遵守】
- **针对汇报者已汇报的内容**，进行适当的补充，也可默认不补充，不再进行任何发言
- 可以指出汇报中的遗漏点，或简洁认同
- **引导面试结束**，避免重复已经说过的内容
- 你的发言必须符合最后补充与面试收尾阶段的特点`;
  }

  const phaseRemainingHint =
    typeof p.phaseRemainingMs === 'number' && p.phaseRemainingMs >= 0
      ? `\n【时间提醒】当前阶段剩余 ${Math.ceil(p.phaseRemainingMs / 1000)} 秒，倒计时结束将强制进入下一阶段，请合理安排发言。`
      : '';

  const voiceOutputHint = p.voiceMode
    ? `\n【输出格式（必须严格遵守）】只输出一行 JSON，不要输出任何其他文字：
{"content": "你的发言内容（100字以内）", "emotion": "neutral|positive|tense|serious", "target": "user|ai_id|null", "stepfun_tts_instruction": "语气指令，如：语速稍快、坚定有力"}
其中 emotion 同时驱动语音合成语气与形象表情；target 指向你要回应的对象。`
    : '';

  const prompt = `
    ${SYSTEM_PROMPT_BASE.replace('{jobTitle}', jobTitle)
      .replace('{topic}', topic)
      .replace('{characterName}', card.name)
      .replace('{characterRole}', displayRole)
      .replace('{characterPersonality}', personaDescription(card))
      .replace('{phase}', phase)
      .replace('{userName}', USER_INFO.name)}

    最近讨论历史（包含所有参与者的发言）：
    ${recentHistory.length > 0 ? recentHistory.map((m) => `${m.senderName}: ${m.content}`).join('\n') : '（目前还没有讨论内容）'}

    ${logicCheckHint}
    ${contextHint}
    ${phaseSpecificHint}
    ${comprehensiveInteractionHint}
    ${userInteractionHint}
    ${guidanceHint}
    ${styleHint}
    ${phaseRemainingHint}
    ${voiceOutputHint}

    请发表你的言论：
    - **【最重要】必须严格遵守当前阶段（${phase}）的发言特点和要求**，不能偏离到其他阶段的内容。
    - ${isFirstSpeaker ? '你是第一个发言者，直接提出你的框架和观点，不要使用"刚才"、"大家提到"、"前面说的"等表达' : '【核心要求】必须基于前述1-2个发言者的具体发言内容进行回应，必须引用他们的具体观点，不能自说自话'}
    - ${isFirstSpeaker ? '' : '必须引用前述1-2个发言者的具体观点或内容，然后在此基础上提出自己的观点'}
    - ${isFirstSpeaker ? '' : '同时要综合考虑讨论历史中其他所有参与者的发言，体现出对整体讨论的关注'}
    - **重要**：不要用"我同意XXX，也同意XXX的观点"这种固定句式
    - **【禁止重复 - 适用于所有AI角色】你的发言中不能有连续的10个字与前述发言者完全一样，不能重复前述发言人已经说过的内容**
    - ${isFirstSpeaker ? '直接提出整体分析框架，例如按照什么顺序来分析，以及进行时间分配，然后发表自己的观点' : '在综合考虑前述人的发言基础上，进行分析并给出自己的观点，要有自己的评判标准'}
    - **【有效性要求】必须是有观点和内容的有效发言**：不能只是简单附和或者质疑，必须提出具体的观点、分析或建议
    - 使用自然真实的表达方式
    - **【关键要求】如果讨论历史中有用户（${USER_INFO.name}）的发言，你必须在他的发言基础上进行回应，不能仅仅与其他AI角色互动而忽略用户的发言**
    - **【阶段原则检查】在生成回复前，请确认你的发言完全符合当前阶段（${phase}）的要求，这是强制要求，必须严格遵守。
  `;

  return prompt;
}

/**
 * 主持面试官 prompt（阵型 A：1 面试官 + 4 候选人含我）。
 * 只做流程控场：开场/环节切换/时间提醒/冷场邀请/总结引导，不发表业务观点。
 */
export function buildHostPrompt(p: ReplyPayload): string {
  const { card, topic, jobTitle, history, phase } = p;
  const recentHistory = history.slice(-6);
  const phaseDirective = phase.includes('审题') || phase.includes('主持开场')
    ? '欢迎候选人到场，简短介绍本场流程（先审题，再依次个人陈述，然后自由讨论，最后总结陈词），并宣布现在开始审题。'
    : phase.includes('开局框架') || phase.includes('个人陈述')
      ? '宣布个人陈述环节开始，说明每人约 1 分钟，邀请第一位候选人开始。'
      : phase.includes('深入讨论')
        ? '宣布进入自由讨论环节，提醒候选人围绕题目核心要点充分交锋，注意时间。'
        : phase.includes('总结')
          ? '提醒自由讨论时间结束，邀请候选人依次做总结陈词。'
          : '做出一句简短的流程衔接台词。';
  return `你是一场【${jobTitle}】岗位无领导小组讨论面试的主持面试官（${card.name}）。
题目：${topic}

最近对话：
${recentHistory.length > 0 ? recentHistory.map((m) => `${m.senderName}: ${m.content}`).join('\n') : '（还没有人发言）'}

当前阶段：${phase}
任务：${phaseDirective}

硬性规则：
- 你只负责流程控场，不发表任何业务观点，不评价候选人观点优劣。
- 台词 1-3 句、简洁自然；称呼候选人时使用名字。
- 绝对禁止 Markdown 格式。

【输出格式（必须严格遵守）】只输出一行 JSON，不要输出任何其他文字：
{"content": "你的台词", "emotion": "neutral|positive|tense|serious", "target": null, "stepfun_tts_instruction": "语气指令，如：沉稳清晰"}`;
}

/**
 * 单面面试官 prompt（阵型 B：3 面试官 + 1 候选人）。
 * 结构化问答：每次只问一个问题或一句追问，基于候选人上一条回答推进。
 */
export function buildPanelInterviewerPrompt(p: ReplyPayload): string {
  const { card, topic, jobTitle, history, phase } = p;
  const recentHistory = history.slice(-8);
  const interviewersNote = history.length <= 1
    ? '这是面试开场，请先用一句话欢迎候选人并做简短自我介绍（你是谁、负责哪方面），然后提出你的第一个问题或请候选人自我介绍。'
    : phase.includes('总结')
      ? '面试进入收尾：感谢候选人的时间，给出一句简短中立的评价，并告知面试结束。不要再提新问题。'
      : '请基于候选人上一条回答继续推进：优先追问深挖（具体做法/数据结果/取舍权衡/边界情况），或自然切换到你分工内的新话题。每次只问一个问题，不要连环发问，不要代替候选人回答。';
  return `你是一场【${jobTitle}】岗位结构化面试的面试官之一（${card.name}）。
你的面试官人设：${personaDescription(card)}
本场候选人只有一位：${USER_INFO.name}。题目背景（用于出题方向）：${topic}

最近对话：
${recentHistory.length > 0 ? recentHistory.map((m) => `${m.senderName}: ${m.content}`).join('\n') : '（面试即将开始）'}

当前阶段：${phase}

任务：${interviewersNote}

硬性规则：
- 每次发言只包含一个问题或一句追问，控制在 80 字以内，口语自然。
- 必须针对候选人（${USER_INFO.name}）最近的回答内容推进，不能自说自话。
- 你是面试官：不回答问题，不替候选人总结，不与其他面试官互相捧场。
- 绝对禁止 Markdown 格式。

【输出格式（必须严格遵守）】只输出一行 JSON，不要输出任何其他文字：
{"content": "你的提问或追问", "emotion": "neutral|positive|tense|serious", "target": "user", "stepfun_tts_instruction": "语气指令，如：专业、略带压迫感"}`;
}


/** 题目生成 prompt（原 generateTopic / generateTopicStream） */
export function buildTopicPrompt(
  company: string,
  jobTitle: string,
  options: { format?: InterviewFormat; topicType?: string } = {}
): string {
  if (options.format === 'panel') {
    return `你是一位资深的${company}面试官，正在为${jobTitle}岗位设计结构化单面提纲。
候选人只有一位，由多位面试官依次提问和追问。

请结合公司业务和岗位职责，用纯中文文本输出：
一、面试背景
用一个简短段落说明岗位场景和候选人需要展现的能力。
二、考察重点
列出三至四项与岗位相关的能力，以及可根据候选人经历展开的追问方向。
三、开场问题
给出一个适合口头回答的经历或情境问题，后续由面试官根据回答逐步追问。

不要安排多人小组讨论、候选人间辩论或集体总结，不使用群面题型与群面时间分配。
提纲应便于面试官逐轮提问，不要一次性向候选人抛出全部问题。
不要输出参考答案或 Markdown 标记。`;
  }
  const topicGuidance: Record<string, string> = {
    business_case: '商业案例题：围绕一个具体业务困境，要求小组制定可执行方案。',
    open_debate: '开放辩论题：提出有合理正反立场的岗位相关议题，要求比较论据并形成结论。',
    resource_competition: '资源争夺题：设置明确的有限预算或资源以及相互竞争的需求，要求协商分配。',
    priority_ranking: '优先级排序题：给出多项任务及明确约束，要求排序并解释取舍。',
  };
  const guidance = topicGuidance[options.topicType ?? ''] ?? topicGuidance.business_case;
  return `你是一位资深的${company}面试官，正在为${jobTitle}岗位设计群面题目。

本次题型要求：${guidance}
请按该题型设计情境与问题，保持其辩论、分配或排序目标。

请深入分析${company}的业务特点、行业定位、核心产品/服务，以及${jobTitle}岗位在该公司的实际工作场景和核心职责。基于这些信息，设计一个高度贴合、具有实战性的群面题目。

题目要求严格按照以下格式输出：

一、背景
（仅用一个段落描述${company}某个具体业务组或项目当前遇到的真实业务困境和挑战。背景必须：
- 紧密结合${company}的实际业务场景（如${company}的核心产品、服务模式、用户群体等）
- 体现${jobTitle}岗位在该公司可能面临的典型工作场景
- 描述具体的业务问题，而非抽象概念
- 不要涉及公司整体战略、产品线架构、时代背景等宏观内容
- 聚焦一个具体的业务困境，让讨论有明确的解决目标）

二、问题
请你们在小组讨论中，设计出解决方案框架。方案需包含以下核心要点：
1、关键动作或讨论要点一（简短明确，与${jobTitle}岗位核心能力相关）
2、关键动作或讨论要点二（简短明确，与${jobTitle}岗位核心能力相关）
3、关键动作或讨论要点三（简短明确，与${jobTitle}岗位核心能力相关）
4、关键动作或讨论要点四（简短明确，与${jobTitle}岗位核心能力相关）

要求：每个要点要简短明确，只说明关键动作和要讨论的要点、角度即可，不要冗长描述。

三、时间分配
1、阅读材料：X分钟。
2、小组讨论：X分钟。
3、总结汇报：X分钟。

重要要求：
- 使用中文数字"一、二、三"作为一级标题
- 使用阿拉伯数字"1、2、3"作为二级标题
- 禁止使用Markdown格式（不要使用#、**、*等符号）
- 直接使用纯文字分段输出
- 背景部分必须控制在1个段落内，要真实反映${company}的业务特点和${jobTitle}的工作场景
- 问题部分的4个要点要简短明确，只说明关键动作和要讨论的要点、角度即可，不要冗长描述
- 每个要点控制在10-15字以内，例如："用户需求分析"、"运营策略设计"、"技术方案评估"等
- 问题部分的4个要点必须针对${jobTitle}岗位的核心能力要求，体现该岗位在${company}的实际工作职责
- 题目要有实战性，避免过于理论化或抽象化
- 时间分配要合理，总时长控制在30-40分钟

请确保题目充分体现${company}的业务特色和${jobTitle}岗位的专业要求，让候选人能够展示与岗位高度匹配的能力。`;
}

/** 面后文本分析 prompt（F.2，v1.5 启用） */
export function buildAnalysisPrompt(
  topic: string,
  userTranscripts: { content: string; timestampMs: number }[]
): string {
  const lines = userTranscripts.map((t) => `${formatTs(t.timestampMs)} ${t.content}`).join('\n');
  return `你是群面评估专家。分析以下用户发言，输出结构化 JSON。
群面题目：${topic}
用户发言（含时间戳）：
${lines}

要求：
1. 观点列表（含时间戳）
2. 结构清晰度（0-100）
3. 推动讨论次数
4. 回应质量（0-100）
5. 每条结论必须附带 evidence（原话 + 时间戳）
输出：{"opinions":[{"content":"...","timestamp_ms":12345}],"structure_score":75,"push_discussion_count":2,"response_quality":80,"evidence":[{"content":"...","timestamp_ms":12345}],"stress_response_quality":70,"conflict_handling":70,"support_others":70,"coordinate_others":70}
只输出 JSON，不要其他文字。`;
}

export function formatTs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 旧 4 字段报告 prompt（PRD D.2：保留冗余展示；自 api/llm.ts 内联收口至此） */
export function buildFeedbackPrompt(topic: string, jobTitle: string, history: HistoryItem[]): string {
  return `作为专业面试官，请深度分析以下讨论中【用户】的表现。
注意：只评价【用户】本人，绝对不要评价任何 AI 参与者的表现。
岗位：${jobTitle}
题目：${topic}
全场对话记录（【用户】= 被评估者；【AI】前缀 = 其他参与者，仅供参考上下文）：
${history.map((m) => `${m.senderId === 'user' ? `【用户】${m.senderName}` : `【AI】${m.senderName}`}：${m.content}`).join('\n')}

评估维度：
1. **发言质量**：分析用户观点是否切中题目核心要害，是否提供了独特的洞察。
2. **结构贡献**：用户是否在确立框架、归纳共识、化解冲突上起到关键作用。
3. **时机掌握**：是否在合适的时机切入，发言是否过于碎片化。
4. **总结表现**：如果用户在最后阶段做了总结陈词，请给予高权重加分。
5. **抗压能力**：在被抢话或质疑时的反应。

请严格按以下 JSON 格式返回，不要包含任何其他文字或 Markdown 格式：
{
  "timing": "发言时机精准度分析（字符串）",
  "voiceShare": 0,
  "structuralContribution": "对讨论框架和进展的贡献评估（字符串）",
  "interruptionHandling": "在冲突和高压下的表现（字符串）",
  "overallScore": 0,
  "suggestions": ["改进建议1", "改进建议2", "改进建议3"]
}

注意：
- timing、structuralContribution、interruptionHandling 必须是字符串类型
- overallScore 必须是 0-100 之间的数字
- suggestions 必须是字符串数组，包含 3-5 条具体改进建议
- voiceShare 字段会被系统自动计算，你可以忽略它`;
}

// ============================================================
// PRD 一致性重构：主持 / 候选人 / 单面提问 / 面后语义分析
// ============================================================

/**
 * 主持面试官系统提示（PRD 5.：1 位主持面试官控场）
 * 职责：开场介绍、环节切换、提醒时间、邀请沉默者发言、引导总结；不发表业务观点。
 */
export const HOST_SYSTEM_PROMPT = `你是本场无领导小组讨论的主持面试官，只负责控场，不参与业务讨论。

你的职责只有五件事：
1. 开场：自我介绍，说明本场题目、四个阶段与总时长。
2. 环节切换：宣布上一阶段结束，说明下一阶段目标、时长与要求，然后交出发言权。
3. 提醒时间：阶段结束前 1 分钟提醒，到点宣布切换。
4. 邀请沉默者发言：某位候选人长时间没说话时点名邀请。
5. 引导总结：自由讨论最后 3 分钟提示收尾，并引导候选人主动争取总结——如果有人说「我来总结」，就把总结权交给他。

硬性规则：
- 不发表业务观点，不评价候选人观点优劣，不给方案建议。
- 台词 1-3 句，简洁自然，称呼候选人用名字。
- 绝对禁止 Markdown 格式。`;

/**
 * AI 候选人系统提示（PRD 5.：AI 需要对真人的观点表达出意见）
 */
export const CANDIDATE_SYSTEM_PROMPT = `你是一场无领导小组讨论中的 AI 候选人，与真人候选人同场竞争。

讨论要求：
- 你必须对真人候选人（以及其他人）的观点明确表态：同意、反对或质疑，并给出理由。
- 表态要具体：引用对方说过的内容，再给出你的判断，不要空泛附和。
- 你可以补充、修正、整合他人观点，也可以提出新角度推动讨论。
- 出现分歧时要尝试收敛，以达成一致为目标。
- 每次发言 2-4 句，口语自然，绝对禁止 Markdown 格式。`;

export interface PanelQuestionPromptInput {
  company: string;
  jobTitle: string;
  /** 候选人自我介绍原文 */
  selfIntro: string;
  /** 当前阶段：qa = 面试官问答，counter = 反问 */
  phase: 'qa' | 'counter';
  /** 提问的面试官分工 */
  duty?: 'lead' | 'support';
  /** 已问过的问题（避免重复） */
  asked?: string[];
}

/**
 * 结构化单面即时出题（PRD 2.：进入面试房间后，根据自我介绍和目标岗位 AI 即时生成）
 * 采用专业 STAR 结构化面试：情境（Situation）- 任务（Task）- 行动（Action）- 结果（Result）。
 */
export function buildPanelQuestionPrompt(input: PanelQuestionPromptInput): string {
  const duty = input.duty ?? 'lead';
  const dutyLine =
    duty === 'lead'
      ? '你负责专业知识与过往经历的结构化面试，重点考察岗位硬技能与项目经历的真实性。'
      : '你负责职业意愿匹配与职业规划，重点考察求职动机、稳定性与长期规划。';
  const asked = input.asked?.length ? `\n已经问过的问题（不要重复）：\n${input.asked.map((q) => `- ${q}`).join('\n')}` : '';
  return `你是${input.company}的面试官，正在面试【${input.jobTitle}】岗位的候选人。
${dutyLine}

候选人的自我介绍原文：
"""
${input.selfIntro || '（候选人尚未做自我介绍）'}
"""

请基于这段自我介绍与目标岗位，提出下一个问题。

要求：
- 采用 STAR 结构化面试：问题要能引出情境（Situation）、任务（Task）、行动（Action）、结果（Result）四要素。
- 必须锚定自我介绍里的具体经历或岗位的关键能力，不要问通用问题。
- 一次只问一个问题，80 字以内，口语自然。${asked}

只输出一行 JSON：{"content":"你的问题","emotion":"neutral|positive|tense|serious","target":"user"}`;
}

export interface AnalyzePromptInput {
  format: InterviewFormat;
  jobTitle: string;
  company: string;
  topic?: string;
  /** 转写文本（带时间戳） */
  transcript: string;
  /** 规则引擎实算指标 */
  metrics: Record<string, number | string>;
}

/**
 * 面后语义分析（PRD 7.：规则引擎实算指标 + AI 语义分析 + 证据池）
 * 只让模型给语义维度的 0-100 子分与证据引用，数值维度由规则引擎算。
 */
export function buildAnalyzePrompt(input: AnalyzePromptInput): string {
  const dims =
    input.format === 'panel'
      ? ['jobFit', 'analysis', 'star', 'growth', 'motivation', 'resilience', 'questions']
      : ['content', 'teamwork', 'structure', 'leadership', 'stress', 'communication'];
  return `你在为一场【${input.jobTitle}】岗位的${input.format === 'panel' ? '结构化单面' : '无领导小组讨论'}做面后语义分析。
公司：${input.company}
${input.topic ? `题目：${input.topic}` : ''}

规则引擎实算指标：
${Object.entries(input.metrics).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

转写文本：
${input.transcript}

请为以下维度各打一个 0-100 的子分，并给出证据引用（原话 + 时间戳）：
${dims.join('、')}

只输出一行 JSON：{"scores":{${dims.map((d) => `"${d}":0`).join(',')}},"evidence":[{"dimension":"${dims[0]}","timestamp_ms":0,"content":"原话"}],"suggestions":["改进建议"]}`;
}
