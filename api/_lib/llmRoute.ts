import type { VercelResponse } from '@vercel/node';
import type { GameEvent, Message, RoleCard, VisualFeatureRow } from '../../types.ts';
import { findRoleCard } from '../../data/roleCards.ts';
import { HOST_CARD, isHostCard } from '../../data/interviewerCards.ts';
import {
  buildFeedbackPrompt,
  buildHostPrompt,
  buildPanelInterviewerPrompt,
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

export function resolveReplyCard(payload: Payload): RoleCard | null {
  const requestedId = textField(payload.card as Payload | undefined ?? {}, 'id');
  const card = isHostCard(requestedId) ? HOST_CARD : findRoleCard(requestedId);
  return card ?? null;
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
  };
}

function promptFor(reply: ReplyPayload): string {
  if (reply.speakerKind === 'host') return buildHostPrompt(reply);
  if (reply.speakerKind === 'interviewer') return buildPanelInterviewerPrompt(reply);
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
