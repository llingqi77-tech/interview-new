/**
 * data/avatar3dCharacters.ts —— 13 个角色的「文生 3D」美术设定与提示词
 *
 * 角色总数 = 12 张候选人角色卡（data/roleCards.ts）+ 1 张主持面试官卡
 * （data/interviewerCards.ts）= 13，每个角色在 data/avatars.ts 里对应唯一的
 * AvatarPreset.id（visionary_01 … host_01），一一映射，不复用。
 *
 * 为什么是黏土手办风：
 *   - 与现有 DiceBear 风格化 SVG 形象同一调性（C7：不用真实名人肖像）；
 *   - 半身像构图，面试间近景（半身取景）不穿帮；
 *   - Rodin Gen-2.5 对「matte clay figurine」的文本还原度高，出图风格统一，
 *     13 个角色并排看像同一套。
 *
 * 提示词结构（Rodin 只吃英文，这里全部英文）：
 *   [风格基线] + [人物] + [发型] + [服装] + [配饰] + [表情] + [构图约束]
 * 改风格只需要改 STYLE_BASELINE，不用动 13 条角色描述。
 */

export type Avatar3dCharacterId =
  | 'visionary_01'
  | 'legend_01'
  | 'master_01'
  | 'pioneer_01'
  | 'investor_01'
  | 'analyst_01'
  | 'consultant_01'
  | 'brand_01'
  | 'ops_01'
  | 'expert_01'
  | 'hr_01'
  | 'tech_01'
  | 'host_01';

export interface Avatar3dCharacter {
  /** 与 AvatarPreset.id 一致；也是落地文件名（<id>.glb） */
  id: Avatar3dCharacterId;
  /** 角色名（与 RoleCard.name / AvatarPreset.name 对齐） */
  name: string;
  /** 角色卡 id；主持面试官对应 interviewer_host */
  roleCardId: string;
  /** 行业 */
  industry: string;
  /** 性格标签（来自角色卡 persona.traits），用于查表核对 */
  traits: string[];
  /** 人物描述段（英文，进提示词） */
  subject: string;
  /** 发型 */
  hair: string;
  /** 服装 */
  outfit: string;
  /** 配饰 */
  accessory: string;
  /** 表情 / 姿态 */
  expression: string;
}

/** 风格基线：13 个角色共用，保证成组后风格一致 */
export const STYLE_BASELINE = [
  'stylized matte clay collectible figurine of a single character',
  'bust sculpture cropped cleanly just below the shoulders with a flat smooth base, no ragged edges',
  'smooth uniform clay surface, soft studio key light from the left',
  'plain light grey seamless studio backdrop',
  'simplified friendly facial features, slightly oversized head',
  'hand-painted vinyl toy look, clean silhouette, no surface noise',
].join(', ');

/** 构图与内容约束：避免多余人物、文字、水印 */
export const PROMPT_CONSTRAINTS = [
  'single character only',
  'no other people',
  'no props in the hands',
  'plain background, no text, no logo, no watermark',
].join(', ');

export const AVATAR_3D_CHARACTERS: Avatar3dCharacter[] = [
  {
    id: 'visionary_01',
    name: '远见者',
    roleCardId: 'tech_visionary',
    industry: 'tech',
    traits: ['激进', '第一性原理', '爱挑战'],
    subject: 'a Chinese man in his mid thirties, lean build, confident gaze',
    hair: 'short black hair',
    outfit: 'navy blue hoodie',
    accessory: 'no accessories',
    expression: 'calm confident expression, relaxed shoulders',
  },
  {
    id: 'legend_01',
    name: '传奇产品人',
    roleCardId: 'product_legend',
    industry: 'tech',
    traits: ['极简', '挑剔', '完美主义'],
    subject: 'a Chinese man in his mid forties, tall slim build, refined reserved gaze',
    hair: 'slicked back black hair with grey at the temples, short trimmed beard',
    outfit: 'charcoal grey tailored suit over a white shirt, no tie',
    accessory: 'none',
    expression: 'skeptical raised eyebrow, lips pressed',
  },
  {
    id: 'master_01',
    name: '供应链大师',
    roleCardId: 'supply_chain_master',
    industry: 'tech',
    traits: ['稳健', '数据驱动'],
    subject: 'a Chinese man in his early fifties, solid steady build, calm patient gaze',
    hair: 'short greying hair, clean shaven',
    outfit: 'navy blue work jacket over a light grey polo shirt',
    accessory: 'round wire glasses',
    expression: 'calm half smile, relaxed shoulders',
  },
  {
    id: 'pioneer_01',
    name: '加密先锋',
    roleCardId: 'crypto_pioneer',
    industry: 'tech',
    traits: ['高调', '营销导向'],
    subject: 'a Chinese man in his late twenties, energetic athletic build, wide grin',
    hair: 'short dyed brown hair with a faded undercut',
    outfit: 'bright orange bomber jacket over a black t-shirt',
    accessory: 'sunglasses pushed up on the head',
    expression: 'big open smile, one hand raised in an excited gesture',
  },
  {
    id: 'investor_01',
    name: '价值投资者',
    roleCardId: 'value_investor',
    industry: 'finance',
    traits: ['长期主义', '保守'],
    subject: 'a Chinese man in his early sixties, dignified posture, gentle wise gaze',
    hair: 'short silver white hair, neatly trimmed grey beard',
    outfit: 'dark navy three piece suit with a burgundy tie',
    accessory: 'gold rimmed reading glasses',
    expression: 'warm composed smile, hands folded',
  },
  {
    id: 'analyst_01',
    name: '投行分析师',
    roleCardId: 'ib_analyst',
    industry: 'finance',
    traits: ['高压', '结果导向'],
    subject: 'a Chinese woman in her early thirties, slim sharp build, intense focused gaze',
    hair: 'dark hair pulled into a tight low bun, no fringe',
    outfit: 'white fitted blouse under a black fitted blazer',
    accessory: 'small stud earrings',
    expression: 'intense direct stare, slight frown, leaning forward',
  },
  {
    id: 'consultant_01',
    name: '战略顾问',
    roleCardId: 'strategy_consultant',
    industry: 'consulting',
    traits: ['结构化', 'MECE'],
    subject: 'a Chinese woman in her mid thirties, neat professional build, clear analytical gaze',
    hair: 'straight shoulder length black bob, side part',
    outfit: 'light grey blazer over a white shirt',
    accessory: 'thin rectangular glasses',
    expression: 'composed neutral expression, slight knowing smile',
  },
  {
    id: 'brand_01',
    name: '品牌总监',
    roleCardId: 'brand_director',
    industry: 'fmcg',
    traits: ['创意', '感性'],
    subject: 'a Chinese woman in her late twenties, creative lively posture, expressive eyes',
    hair: 'wavy shoulder length chestnut hair',
    outfit: 'mustard yellow oversized blouse',
    accessory: 'large round gold earrings',
    expression: 'warm expressive smile, head slightly tilted',
  },
  {
    id: 'ops_01',
    name: '运营总监',
    roleCardId: 'ops_director',
    industry: 'manufacturing',
    traits: ['务实', '流程导向'],
    subject: 'a Chinese man in his early forties, sturdy practical build, matter of fact gaze',
    hair: 'short cropped black hair',
    outfit: 'steel blue button up work shirt with sleeves rolled to the elbow',
    accessory: 'wristwatch',
    expression: 'focused neutral look, shoulders squared',
  },
  {
    id: 'expert_01',
    name: '行业专家',
    roleCardId: 'industry_expert',
    industry: 'medical_education',
    traits: ['严谨', '耐心'],
    subject: 'a Chinese woman in her early fifties, slender upright build, kind attentive gaze',
    hair: 'short neat salt and pepper hair',
    outfit: 'white lab coat over a light blue shirt',
    accessory: 'thin gold rim glasses',
    expression: 'serene patient expression, slight nod',
  },
  {
    id: 'hr_01',
    name: '招聘经理',
    roleCardId: 'hr_manager',
    industry: 'hr',
    traits: ['亲和', '行为面试'],
    subject: 'a Chinese woman in her late twenties, friendly open posture, soft welcoming gaze',
    hair: 'straight shoulder length dark brown hair',
    outfit: 'soft pink cardigan over a white top',
    accessory: 'none',
    expression: 'broad friendly smile, relaxed open hands',
  },
  {
    id: 'tech_01',
    name: '技术面试官',
    roleCardId: 'tech_interviewer',
    industry: 'internet',
    traits: ['逻辑', '深度'],
    subject: 'a Chinese man in his mid thirties, lean build, serious gaze',
    hair: 'short black hair',
    outfit: 'dark grey crew neck sweater',
    accessory: 'no accessories',
    expression: 'serious expression, looking straight at the camera, upright posture',
  },
  {
    id: 'host_01',
    name: '主持面试官',
    roleCardId: 'interviewer_host',
    industry: 'general',
    traits: ['控场', '中立', '时间感强'],
    subject: 'a Chinese man in his late thirties, medium build, calm neutral presence',
    hair: 'short black hair combed to the side',
    outfit: 'medium grey business shirt, sleeves buttoned, no jacket',
    accessory: 'plain shirt collar, no accessories',
    expression: 'neutral attentive expression, relaxed slight smile',
  },
];

/** 拼一条完整提示词 */
export function buildAvatarPrompt(c: Avatar3dCharacter): string {
  return [
    STYLE_BASELINE,
    c.subject,
    c.hair,
    c.outfit,
    c.accessory,
    c.expression,
    PROMPT_CONSTRAINTS,
  ]
    .filter(Boolean)
    .join(', ');
}

/** 按 id 取角色 */
export function findAvatar3dCharacter(id: string): Avatar3dCharacter | undefined {
  return AVATAR_3D_CHARACTERS.find((c) => c.id === id);
}
