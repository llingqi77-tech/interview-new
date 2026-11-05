
// ============================================================
// LGD 群面模拟器 v0.7-tow 类型定义
// 对应 PRD 附录 A（角色卡）/ D（数据模型）/ E.5（报告结构）
// ============================================================

export type CharacterType = 'AGGRESSIVE' | 'STRUCTURED' | 'DETAIL';

/** 角色卡 persona（附录 A.1） */
export interface RolePersona {
  traits: string[];
  speaking_style: string;
  conflict_strategy: string;
  /** 协作倾向 0-1 */
  cooperation_level: number;
  /** 领导倾向 0-1 */
  leadership_tendency: number;
  /** 冲突等级：用于每场 1 高冲突 + 1 高协作 + 1 中立 的分配约束 */
  conflict_level: 'high' | 'medium' | 'low';
  /** 迁移自原 3 角色的性格文案（PRD F.0：prompt 资产不丢弃） */
  legacy_personality?: string;
  /** 迁移自原角色的 id（char1 张强 / char2 李雅 / char3 王敏） */
  legacy_id?: string;
  legacy_name?: string;
}

/**
 * 角色卡 voice（附录 A.1）。
 * voice_id 同时用于 StepFun TTS 与 Realtime 分路建连。
 * 官方音色和音色复刻返回的 voice id 都填这里；
 * Realtime 的 voice 只能在建连时锁定，换音色 = 换一条分路，不能对已开的 session.update。
 */
export interface RoleVoice {
  provider: 'stepfun';
  /**
   * 音色 ID。可以是 StepFun TTS 官方音色、Realtime 系统音色，
   * 或 https://platform.stepfun.com/docs/zh/api-reference/audio/create-voice 返回的复刻 voice id。
   * 换克隆音色只改这个字段（或下面的 realtime_voice_id），不用改调用代码。
   */
  voice_id: string;
  /**
   * Realtime 出声音色。缺省时由 voice_id 解析：
   * 旧 TTS 音色映射到听感最近的系统音色；未知 ID 视为复刻音色，原样透传。
   * 显式填写后优先于解析结果（主持与候选人错开、或直接填复刻 ID）。
   */
  realtime_voice_id?: string;
  /** 语速倍率（TTS 降级链路使用；Realtime 会话没有独立语速字段） */
  rate: number;
  emotion_default: string;
}

/** 结构化单面默认 2 位面试官，可切换为 3 位。 */
export type PanelSize = 2 | 3;
export const PANEL_SIZES = [2, 3] as const;
export const DEFAULT_PANEL_SIZE: PanelSize = 2;

export interface RoleAvatar {
  preset_id: string;
  emotion_set: string[];
}

export interface RoleBehavior {
  speak_probability: number;
  interrupt_probability: number;
  /** 平均发言时长（秒） */
  avg_speak_duration: number;
  response_to_challenge: string;
  summary_tendency: number;
}

/** AI 角色卡（附录 A.1 字段结构，12 张首发） */
export interface RoleCard {
  id: string;
  name: string;
  industry: string;
  persona: RolePersona;
  voice: RoleVoice;
  avatar: RoleAvatar;
  behavior: RoleBehavior;
  /** 候选人背景（PRD 5. AI 候选人背景设计规范）；主持/面试官卡可缺省 */
  background?: CandidateBackground;
}

/** 预设形象（附录 D.3 avatars 表） */
export interface AvatarPreset {
  id: string;
  name: string;
  industry: string;
  type: 'preset' | 'uploaded';
  asset_url: string;
  viseme_asset_url?: string | null;
  emotion_asset_url?: string | null;
  default_voice_id: string;
  tags: string[];
}

/**
 * 角色的文生 3D 模型条目（Hyper3D / Rodin Gen-2.5 生成）
 * 由 scripts/gen-avatar-models.mjs 写入 data/avatarModels.ts；美术设定见 data/avatar3dCharacters.ts。
 */
export interface AvatarModelEntry {
  id: string;
  name: string;
  /** 站内路径，如 /avatars/3d/visionary_01.glb */
  model_url: string;
  preview_url: string | null;
  generator: string;
  tier: string;
  mesh_mode: string;
  quality: number;
  /** 绑骨后烘进去的动画 clip（没有绑骨则为 null） */
  animation: string | null;
  generation_id: string;
  rigging_id: string | null;
  bytes: number;
  credits: number | null;
  generated_at: string;
}

/** 群面阵型：lgd = 1 主持 + 3 AI 候选人 + 用户；panel = 2 或 3 位面试官 + 用户（结构化单面，默认 3） */
export type InterviewFormat = 'lgd' | 'panel';

/** 阶段 id（群面四阶段 + 单面三阶段） */
export type PhaseId = 'READING' | 'INTRO' | 'FREE_DISCUSSION' | 'SUMMARY' | 'SELF_INTRO' | 'QA' | 'COUNTER_ASK';

export interface PhaseDef {
  id: PhaseId;
  /** 展示用阶段名 */
  label: string;
  /** 传递给 LLM 的阶段名（复用现有 prompt 资产） */
  promptPhase: string;
  /** 阶段时长（毫秒） */
  durationMs: number;
  /** 是否允许发言 */
  allowSpeech: boolean;
  /** 侧边栏阶段说明 */
  description: string;
  /** 阶段序号（1 起） */
  order: number;
}

/** 发言权调度事件（events 表，PRD 4.1.4 / D.3） */
export type GameEventType =
  | 'stage_change'
  | 'interrupt'
  | 'yield'
  | 'speak_grant'
  | 'time_warning'
  | 'wrap_up';

export interface GameEvent {
  event_type: GameEventType;
  actor: string;
  target: string;
  timestamp_ms: number;
  metadata?: Record<string, unknown>;
}

/** 显式说话人（M7 §6：Realtime 通道 = user；LLM+TTS 通道 = ai:<cardId>；系统提示 = system） */
export type Speaker = 'user' | `ai:${string}` | 'system';
/** 来源通道：报告里标注「实时语音 / AI 生成 / 手动输入」 */
export type MessageSource = 'realtime' | 'llm' | 'text';

export interface Message {
  id: string;
  senderId: string; // 'user' 或角色卡 id
  senderName: string;
  content: string;
  timestamp: number;
  type: 'system' | 'message';
  /** v1.5：语音化后带时间戳（PRD D.2 transcripts） */
  startMs?: number;
  endMs?: number;
  confidence?: number;
  stepfunSegmentId?: string | null;
  /** 情绪（LLM emotion 字段，驱动 TTS instruction 与形象表情） */
  emotion?: string;
  /** 显式说话人；缺省时由 senderId 派生，保证旧代码与旧数据行为一致（M7 §6，全部可选向后兼容） */
  speaker?: Speaker;
  /** 来源通道（M7 §6） */
  source?: MessageSource;
}
export interface FeedbackData {
  timing: string;
  voiceShare: number; // 0-100
  structuralContribution: string;
  interruptionHandling: string;
  overallScore: number;
  suggestions: string[];
}

/** 证据池条目（PRD 7.3） */
export interface Evidence {
  id: string;
  modality: 'text' | 'voice' | 'visual' | 'event';
  timestamp_ms: number;
  content: string;
  dimension_hint: 'content' | 'voice' | 'visual' | 'stress' | 'teamwork';
  /** 关联消息序号（报告内定位） */
  message_index?: number;
}
// ============================================================
// M6 视觉维度（PRD 附录 C.2 / D.4）
// 摄像头画面在浏览器本地推理（MediaPipe FaceLandmarker），
// 只上传/落库本文件的数值与枚举，原始视频 0 字节上传（C3/C4）。
// ============================================================

/** 视觉情绪（blendshapes 规则映射，PRD 4.3） */
export type VisualEmotion = 'neutral' | 'happy' | 'nervous' | 'serious';

/** 头部姿态（欧拉角，单位度） */
export interface VisualHeadPose {
  /** 俯仰：负值低头（< -15° 记为低头） */
  pitch: number;
  /** 偏航：|yaw| > 20° 记为偏头 */
  yaw: number;
  /** 翻滚：头部倾斜 */
  roll: number;
}

/** 每秒一条视觉聚合特征（对齐 db/migration-v0.7.sql visual_features） */
export interface VisualFeatureRow {
  /** 相对 sessionStartAt 的毫秒数（每秒一行，行不等距时按墙钟解析） */
  timestamp_ms: number;
  /** 本秒内有脸帧中「视线看向镜头」占比 0-1 */
  eye_contact: number;
  /** 本秒主导情绪 */
  emotion: VisualEmotion;
  /** 本秒头部姿态均值（度） */
  head_pose: VisualHeadPose;
  /** 本秒采样帧中检测到恰好一张正脸的占比 0-1 */
  engagement: number;
}

/** 视觉统计（summarizeVisual 输出，喂给报告引擎） */
export interface VisualStatsInput {
  /** 有效采样秒数（每秒一行） */
  validRows: number;
  /** 眼神接触均值 0-1 */
  eyeContactRatio: number;
  /** nervous 占比 0-1 */
  nervousRatio: number;
  /** 低头占比 0-1 */
  headDownRatio: number;
  /** 偏头占比 0-1 */
  headTurnRatio: number;
  /** 低头或偏头占比 0-1 */
  headPoseRatio: number;
  /** 面部检测稳定性均值 0-1 */
  engagementRatio: number;
}

export interface VisualStats extends VisualStatsInput {
  /** 维度内原始分 0-100（PRD C.2 权重合成） */
  rawScore: number;
  /** 显著偏离段证据（≤3 段） */
  evidence: Evidence[];
}

/** 报告维度（PRD 附录 C，M3 过渡权重：内容 40 / 语音 25 / 抗压 20 / 协作 15） */
export interface DimensionScore {
  score: number;
  max: number;
  evidence: Evidence[];
  /** 规则引擎实算指标摘要 */
  metrics?: Record<string, number | string>;
  note?: string;
}

/** 面后报告 v1.5（PRD E.5） */
export interface ReportV15 {
  session_id: number | null;
  overall_score: number;
  dimensions: {
    content: DimensionScore;
    voice: DimensionScore;
    visual: DimensionScore & { status: 'not_enabled' | 'enabled' };
    stress: DimensionScore;
    teamwork: DimensionScore;
  };
  suggestions: string[];
  /** 旧 4 字段保留冗余展示（PRD D.2） */
  legacy?: FeedbackData;
  created_at?: string;
}

export interface SimulationState {
  topic: string;
  jobTitle: string;
  company: string;
  status: 'IDLE' | 'PREPARING' | 'DISCUSSING' | 'FINISHED';
  /** 群面阵型（缺省 lgd，向后兼容旧数据） */
  format?: InterviewFormat;
}

// ============================================================
// PRD 一致性重构：状态机 / 题型 / 维度 / 阶段
// ============================================================

/** 四段式流程（PRD 1. 整体流程总览） */
export const STATUS_FLOW = ['IDLE', 'PREPARING', 'DISCUSSING', 'FINISHED'] as const;
export type SimulationStatus = (typeof STATUS_FLOW)[number];

/** 无领导小组讨论四种题目类型（PRD 2. 练习配置） */
export type LgdTopicType = 'business_case' | 'open_debate' | 'resource_scramble' | 'priority_rank';

export const LGD_TOPIC_TYPES: { id: LgdTopicType; label: string; hint: string }[] = [
  { id: 'business_case', label: '商业案例题', hint: '给定经营场景，要求给出可落地的方案与取舍' },
  { id: 'open_debate', label: '开放辩论题', hint: '存在对立立场，要求论证并尝试达成一致' },
  { id: 'resource_scramble', label: '资源争夺题', hint: '有限资源在多个诉求方之间分配' },
  { id: 'priority_rank', label: '优先级排序题', hint: '多个选项排序并说明排序依据' },
];

/** 结构化单面阶段（PRD 6. 第二部分：结构化单面） */
export type PanelPhaseId = 'SELF_INTRO' | 'QA' | 'COUNTER_ASK';
/** 群面阶段（PRD 5. 第一部分：无领导小组讨论） */
export type LgdPhaseId = 'READING' | 'INTRO' | 'FREE_DISCUSSION' | 'SUMMARY';
export type AnyPhaseId = LgdPhaseId | PanelPhaseId | 'FINISHED';

/** AI 候选人背景（PRD 5. AI 候选人背景设计规范） */
export interface CandidateBackground {
  /** 本科 / 硕士 / 博士 */
  education: '本科' | '硕士' | '博士';
  /** 学校层次描述，用于区分候选人 */
  school: string;
  /** 专业方向（3 人互异） */
  major: string;
  /** 与目标公司/岗位匹配的实习经历 */
  internship: string;
}

/** 面试官级别（PRD：至少 manager 级别以上） */
export type InterviewerLevel = 'manager' | 'senior_manager' | 'director' | 'vp' | 'head';

/** 岗位族：用于「岗位匹配」把面试官与岗位对齐 */
export type JobFamily = 'tech' | 'product' | 'finance' | 'supply' | 'consulting' | 'marketing' | 'hr' | 'general';

/** 面试官形象卡（PRD 2. 结构化单面：6 个面试官形象） */
export interface InterviewerCard {
  id: string;
  /** 形象名：科技远见者 / 产品传奇 / … */
  archetype: string;
  name: string;
  title: string;
  company: string;
  level: InterviewerLevel;
  yearsExperience: number;
  jobFamilies: JobFamily[];
  /** 形象资源 id（data/avatars.ts） */
  avatar: string;
  voiceId: string;
  /** 本场角色：主持面试官 / 主面试官 / 副面试官 */
  role: 'host' | 'lead' | 'support';
  /** 一句话人设，喂给 LLM */
  bio: string;
}
