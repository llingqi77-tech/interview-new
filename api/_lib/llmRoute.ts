import type { VercelResponse } from '@vercel/node';
import type { GameEvent, Message, RoleCard, VisualFeatureRow } from '../../types.ts';
import { findRoleCard } from '../../data/roleCards.ts';
import { HOST_CARD, isHostCard } from '../../data/interviewerCards.ts';
import {
  buildFeedbackPrompt,
  buildHostPrompt,
  buildPanelInterviewerPrompt,
  buildPanelQuestionPrompt,
  buildReplyPrompt,
  buildTopicPrompt,
  type HistoryItem,
  type ReplyPayload,
} from './prompts.ts';
import { callDeepSeek, callDeepSeekStream } from './llm.ts';
import { createSseWriter, type SseWriter } from './sse.ts';
import { createStringFieldReader, safeJsonParse, type IncrementalStringFieldReader } from './jsonStream.ts';
import { runAnalysis } from './analyze.ts';

export const TOPIC_TEMPERATURE = 0.7;
export const REPLY_TEMPERATURE = 0.8;
export const FEEDBACK_TEMPERATURE = 0.3;
export const EMPTY_REPLY_FALLBACK = '时间紧迫，我们必须尽快达成共识。';
export const TOPIC_FAILURE_FALLBACK = '题目生成失败，请手动输入。';
const DEFAULT_ANALYZE_DURATION_MS = 25 * 60 * 1000;

type Payload = Record<string, unknown>;

export function readPayload(value: unknown): Payload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Payload;
}

function textField(payload: Payload, key: string, fallback = ''): string {
  const value = payload[key];
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  return String(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberField(payload: Payload, key: string, fallback: number): number {
  return finiteNumber(payload[key]) ?? fallback;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function historyOf(value: unknown): HistoryItem[] {
  return Array.isArray(value) ? (value as HistoryItem[]) : [];
}

export function cleanTopicText(text: string): string {
  return text.replace(/[*#`>]/g, '').trim();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function bindAbort(response: VercelResponse): AbortSignal {
  const controller = new AbortController();
  response.on?.('close', () => controller.abort());
  return controller.signal;
}

async function streamText(
  response: VercelResponse,
  prompt: string,
  temperature: number,
  purpose: string,
  onDone: (full: string, sse: SseWriter) => void,
): Promise<void> {
  const sse = createSseWriter(response);
  try {
    const full = await callDeepSeekStream(
      prompt,
      temperature,
      (chunk) => sse.send('delta', { delta: chunk }),
      bindAbort(response),
      purpose,
    );
    onDone(full, sse);
  } catch (err) {
    sse.send('error', { message: errorMessage(err) });
  } finally {
    sse.close();
  }
}

export async function handleTopic(response: VercelResponse, payload: Payload, stream?: boolean): Promise<void> {
  const company = textField(payload, 'company');
  const jobTitle = textField(payload, 'jobTitle');
  if (!company || !jobTitle) {
    response.status(400).json({ error: 'company 与 jobTitle 必填' });
    return;
  }
  const prompt = buildTopicPrompt(company, jobTitle, {
    format: payload.format === 'panel' ? 'panel' : 'lgd',
    topicType: typeof payload.topicType === 'string' ? payload.topicType : undefined,
  });
  if (stream) {
    await streamText(response, prompt, TOPIC_TEMPERATURE, 'topic', (full, sse) => {
      const cleaned = cleanTopicText(full);
      sse.send('done', { content: cleaned || TOPIC_FAILURE_FALLBACK });
    });
    return;
  }
  const full = await callDeepSeek(prompt, TOPIC_TEMPERATURE, 'topic');
  response.status(200).json({ content: cleanTopicText(full) || TOPIC_FAILURE_FALLBACK });
}

/**
 * 解析发言角色卡。
 * 优先用服务端注册表（12 张首发卡 + 主持卡）；本场动态生成的候选人/面试官
 * 由客户端随请求带上完整卡片（只有人设文案，无密钥），服务端做结构校验后使用。
 */
export function resolveReplyCard(payload: Payload): RoleCard | null {
  const raw = (payload.card as Payload | undefined) ?? {};
  const requestedId = textField(raw, 'id');
  const known = isHostCard(requestedId) ? HOST_CARD : findRoleCard(requestedId);
  if (known) return known;
  return sanitizeCard(raw);
}

const EMOTIONS = ['neutral', 'positive', 'tense', 'serious'];

function sanitizeCard(raw: Payload): RoleCard | null {
  const id = textField(raw, 'id');
  const name = textField(raw, 'name');
  if (!id || !name) return null;
  const persona = (raw.persona as Payload | undefined) ?? {};
  const voice = (raw.voice as Payload | undefined) ?? {};
  const behavior = (raw.behavior as Payload | undefined) ?? {};
  const traits = Array.isArray(persona.traits) ? persona.traits.filter((t): t is string => typeof t === 'string').slice(0, 6) : [];
  return {
    id: id.slice(0, 64),
    name: name.slice(0, 32),
    industry: textField(raw, 'industry', 'general').slice(0, 32),
    persona: {
      traits,
      speaking_style: textField(persona, 'speaking_style', '自然口语').slice(0, 200),
      conflict_strategy: textField(persona, 'conflict_strategy', 'compromise').slice(0, 64),
      cooperation_level: finiteNumber(persona.cooperation_level) ?? 0.6,
      leadership_tendency: finiteNumber(persona.leadership_tendency) ?? 0.5,
      conflict_level: persona.conflict_level === 'high' || persona.conflict_level === 'low' ? persona.conflict_level : 'medium',
    },
    voice: {
      provider: 'stepfun',
      voice_id: textField(voice, 'voice_id', 'zhengpaiqingnian').slice(0, 64),
      rate: finiteNumber(voice.rate) ?? 1,
      emotion_default: EMOTIONS.includes(String(voice.emotion_default)) ? String(voice.emotion_default) : 'neutral',
    },
    avatar: { preset_id: 'candidate_01', emotion_set: ['neutral'] },
    behavior: {
      speak_probability: finiteNumber(behavior.speak_probability) ?? 0.7,
      interrupt_probability: finiteNumber(behavior.interrupt_probability) ?? 0.3,
      avg_speak_duration: finiteNumber(behavior.avg_speak_duration) ?? 30,
      response_to_challenge: textField(behavior, 'response_to_challenge', 'compromise').slice(0, 64),
      summary_tendency: finiteNumber(behavior.summary_tendency) ?? 0.3,
    },
  };
}

export function buildReplyPayload(payload: Payload, card: RoleCard): ReplyPayload {
  const speakerKind = payload.speakerKind === 'host' || payload.speakerKind === 'interviewer' ? payload.speakerKind : 'candidate';
  return {
    card,
    topic: textField(payload, 'topic'),
    jobTitle: textField(payload, 'jobTitle'),
    history: historyOf(payload.history),
    phase: textField(payload, 'phase', '开局框架阶段'),
    summaryGuided: Boolean(payload.summaryGuided),
    summaryVolunteered: Boolean(payload.summaryVolunteered),
    currentKeyPoint: typeof payload.currentKeyPoint === 'string' ? payload.currentKeyPoint : null,
    keyPointDiscussionCount: numberField(payload, 'keyPointDiscussionCount', 0),
    allKeyPointsDiscussed: Boolean(payload.allKeyPointsDiscussed),
    allKeyPoints: stringList(payload.allKeyPoints),
    currentKeyPointIndex: numberField(payload, 'currentKeyPointIndex', 0),
    voiceMode: Boolean(payload.voiceMode),
    speakerKind,
    phaseRemainingMs: finiteNumber(payload.phaseRemainingMs),
    company: textField(payload, 'company'),
    selfIntro: typeof payload.selfIntro === 'string' ? payload.selfIntro : undefined,
    panelDuty: payload.panelDuty === 'support' ? 'support' : payload.panelDuty === 'lead' ? 'lead' : undefined,
  };
}

function promptFor(reply: ReplyPayload): string {
  if (reply.speakerKind === 'host') return buildHostPrompt(reply);
  if (reply.speakerKind === 'interviewer') {
    // 单面：有自我介绍时按 STAR 结构化即时出题（PRD 2. / 6.）
    if (reply.selfIntro && reply.selfIntro.trim()) {
      return buildPanelQuestionPrompt({
        company: reply.company ?? '',
        jobTitle: reply.jobTitle,
        selfIntro: reply.selfIntro,
        phase: 'qa',
        duty: reply.panelDuty ?? 'lead',
        asked: reply.history.filter((h) => h.senderId !== 'user').map((h) => h.content).slice(-6),
      });
    }
    return buildPanelInterviewerPrompt(reply);
  }
  return buildReplyPrompt(reply);
}

interface ParsedReply {
  content: string;
  emotion?: string;
  target?: string | null;
  stepfun_tts_instruction?: string | null;
}

function parseReply(full: string, fallbackEmotion: string): ParsedReply & { emotion: string; target: string | null; stepfun_tts_instruction: string | null } {
  const parsed = safeJsonParse<ParsedReply>(full);
  const content = (parsed?.content ?? full).trim() || EMPTY_REPLY_FALLBACK;
  return {
    content,
    emotion: parsed?.emotion ?? fallbackEmotion,
    target: parsed?.target ?? null,
    stepfun_tts_instruction: parsed?.stepfun_tts_instruction ?? null,
  };
}

/** 边收边判断：JSON 只透传 content 字段，纯文本整段转发 */
export class ReplyContentSplitter {
  private mode: 'detect' | 'json' | 'raw' = 'detect';
  private rawAcc = '';
  private readonly reader: IncrementalStringFieldReader = createStringFieldReader('content');

  push(chunk: string): string | null {
    if (this.mode === 'raw') return chunk;
    if (this.mode === 'json') return this.reader.push(chunk);
    this.rawAcc += chunk;
    const trimmed = this.rawAcc.trimStart();
    if (!trimmed) return null;
    if (trimmed.startsWith('{')) {
      this.mode = 'json';
      return this.reader.push(this.rawAcc);
    }
    this.mode = 'raw';
    return this.rawAcc;
  }

  flushTail(): string {
    return this.reader.flushTail();
  }
}

async function streamReply(response: VercelResponse, prompt: string, card: RoleCard): Promise<void> {
  const sse = createSseWriter(response);
  const splitter = new ReplyContentSplitter();
  try {
    const full = await callDeepSeekStream(
      prompt,
      REPLY_TEMPERATURE,
      (chunk) => {
        const delta = splitter.push(chunk);
        if (delta) sse.send('delta', { delta });
      },
      bindAbort(response),
      'reply',
    );
    const parsed = parseReply(full, card.voice.emotion_default);
    const tail = splitter.flushTail();
    if (tail) sse.send('delta', { delta: tail });
    sse.send('done', parsed);
  } catch (err) {
    sse.send('error', { message: errorMessage(err) });
  } finally {
    sse.close();
  }
}

export async function handleReply(response: VercelResponse, payload: Payload, stream?: boolean): Promise<void> {
  const card = resolveReplyCard(payload);
  if (!card) {
    response.status(400).json({ error: '未知角色卡 id' });
    return;
  }
  const reply = buildReplyPayload(payload, card);
  const prompt = promptFor(reply);
  if (stream) {
    await streamReply(response, prompt, card);
    return;
  }
  const full = await callDeepSeek(prompt, REPLY_TEMPERATURE, 'reply');
  response.status(200).json(parseReply(full, card.voice.emotion_default));
}

interface FeedbackJson {
  timing?: string;
  structuralContribution?: string;
  interruptionHandling?: string;
  overallScore?: number;
  suggestions?: string[];
}

function isCompleteFeedback(parsed: FeedbackJson | null): parsed is Required<FeedbackJson> {
  return Boolean(
    parsed &&
      typeof parsed.timing === 'string' &&
      typeof parsed.structuralContribution === 'string' &&
      typeof parsed.interruptionHandling === 'string' &&
      typeof parsed.overallScore === 'number' &&
      Number.isFinite(parsed.overallScore) &&
      Array.isArray(parsed.suggestions),
  );
}

export function voiceShareOf(history: HistoryItem[]): number {
  if (history.length === 0) return 0;
  const userCount = history.filter((item) => item.senderId === 'user').length;
  return Math.round((userCount / history.length) * 100);
}

export async function handleFeedback(response: VercelResponse, payload: Payload): Promise<void> {
  const topic = textField(payload, 'topic');
  const jobTitle = textField(payload, 'jobTitle');
  const history = historyOf(payload.history);
  const full = await callDeepSeek(buildFeedbackPrompt(topic, jobTitle, history), FEEDBACK_TEMPERATURE, 'feedback');
  const parsed = safeJsonParse<FeedbackJson>(full);
  if (!isCompleteFeedback(parsed)) {
    response.status(502).json({ error: 'LLM_RESPONSE_INVALID', message: 'AI 返回的 JSON 格式不完整' });
    return;
  }
  response.status(200).json({
    timing: parsed.timing,
    voiceShare: voiceShareOf(history),
    structuralContribution: parsed.structuralContribution,
    interruptionHandling: parsed.interruptionHandling,
    overallScore: parsed.overallScore,
    suggestions: parsed.suggestions,
  });
}

export async function handleAnalyze(response: VercelResponse, payload: Payload): Promise<void> {
  const report = await runAnalysis({
    format: textField(payload, 'format') === 'panel' ? 'panel' : 'lgd',
    topic: textField(payload, 'topic'),
    transcripts: Array.isArray(payload.messages) ? (payload.messages as Message[]) : [],
    events: Array.isArray(payload.events) ? (payload.events as GameEvent[]) : [],
    sessionStartAt: finiteNumber(payload.sessionStartAt) ?? Date.now(),
    durationMs: finiteNumber(payload.durationMs) ?? DEFAULT_ANALYZE_DURATION_MS,
    visualRows: Array.isArray(payload.visual_rows) ? (payload.visual_rows as VisualFeatureRow[]) : [],
  });
  report.session_id = finiteNumber(payload.session_id) ?? null;
  response.status(200).json(report);
}

export async function dispatchLlmAction(
  response: VercelResponse,
  action: string,
  payload: Payload,
  stream?: boolean,
): Promise<void> {
  if (action === 'topic') return handleTopic(response, payload, stream);
  if (action === 'reply') return handleReply(response, payload, stream);
  if (action === 'feedback') return handleFeedback(response, payload);
  if (action === 'analyze') return handleAnalyze(response, payload);
  response.status(400).json({ error: `未知 action: ${action}` });
}
