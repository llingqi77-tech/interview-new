import type { Message, RoleCard, FeedbackData, InterviewReport, InterviewFormat } from '../types';
import { readSseResponse } from './sse.ts';
/**
 * LLM 服务客户端（PRD 4.1.1 / D1 修复）
 * 只调 /api/llm 服务端代理；本文件不包含任何 API key 处理逻辑。
 * DeepSeek key 仅存服务端环境变量（C9）。
 */

const API_BASE = '/api';


export interface ReplyResult {
  content: string;
  emotion: string;
  target: string | null;
  stepfun_tts_instruction: string | null;
}

export interface ReplyParams {
  card: RoleCard;
  topic: string;
  jobTitle: string;
  history: Message[];
  phase: string;
  summaryGuided?: boolean;
  summaryVolunteered?: boolean;
  currentKeyPoint?: string | null;
  keyPointDiscussionCount?: number;
  allKeyPointsDiscussed?: boolean;
  allKeyPoints?: string[];
  currentKeyPointIndex?: number;
  /** 语音版：LLM 输出 JSON（emotion/instruction），用于 TTS 与形象表情 */
  voiceMode?: boolean;
  /** 发言者身份：candidate/host/interviewer（服务端 prompt 分支） */
  speakerKind?: 'candidate' | 'host' | 'interviewer';
  phaseRemainingMs?: number;
  sessionId?: number | null;
}

interface LlmResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function postLlm<T>(body: Record<string, unknown>): Promise<LlmResponse<T>> {
  const res = await fetch(`${API_BASE}/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, data, error: (data as unknown as { message?: string })?.message ?? `HTTP ${res.status}` };
  }
  return { ok: true, status: res.status, data };
}

/** 读取 SSE 流：onEvent(event, dataObj) */

/** 按面试模式生成群面题目或单面提纲（SSE 透传）。 */
export async function generateTopicStream(
  company: string,
  jobTitle: string,
  onChunk: (chunk: string) => void,
  options: { format?: InterviewFormat; topicType?: string } = {}
): Promise<string> {
  const res = await fetch(`${API_BASE}/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'topic',
      payload: { company, jobTitle, ...options },
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`题目生成失败: ${res.status} ${text}`);
  }
  let full = '';
  await readSseResponse(res, (event, data) => {
    if (event === 'delta' && typeof data.delta === 'string') {
      full += data.delta;
      onChunk(data.delta);
    } else if (event === 'done' && typeof data.content === 'string') {
      full = data.content;
    } else if (event === 'error') {
      throw new Error(String(data.message ?? 'LLM 流式错误'));
    }
  });
  return full.trim() || '题目生成失败，请手动输入。';
}

/** 角色发言（voiceMode 时流式返回 content 增量 + emotion/target 元数据） */
export async function generateAIReply(
  params: ReplyParams,
  onDelta?: (chunk: string) => void
): Promise<ReplyResult> {
  const payload: Record<string, unknown> = {
    card: { id: params.card.id },
    topic: params.topic,
    jobTitle: params.jobTitle,
    history: params.history.map((m) => ({ senderId: m.senderId, senderName: m.senderName, content: m.content })),
    phase: params.phase,
    summaryGuided: params.summaryGuided,
    summaryVolunteered: params.summaryVolunteered,
    currentKeyPoint: params.currentKeyPoint ?? null,
    keyPointDiscussionCount: params.keyPointDiscussionCount ?? 0,
    allKeyPointsDiscussed: params.allKeyPointsDiscussed,
    allKeyPoints: params.allKeyPoints ?? [],
    currentKeyPointIndex: params.currentKeyPointIndex ?? 0,
    voiceMode: params.voiceMode ?? false,
    speakerKind: params.speakerKind ?? 'candidate',
    phaseRemainingMs: params.phaseRemainingMs,
    session_id: params.sessionId ?? null,
  };

  if (onDelta) {
    // 流式：SSE 增量 + done 元数据
    const res = await fetch(`${API_BASE}/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reply', payload, stream: true, session_id: params.sessionId ?? null }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`角色发言失败: ${res.status} ${text}`);
    }
    let result: ReplyResult | null = null;
    let streamError: string | null = null;
    await readSseResponse(res, (event, data) => {
      if (event === 'delta' && typeof data.delta === 'string') {
        onDelta(data.delta);
      } else if (event === 'done') {
        result = {
          content: String(data.content ?? ''),
          emotion: String(data.emotion ?? 'neutral'),
          target: typeof data.target === 'string' ? data.target : null,
          stepfun_tts_instruction: typeof data.stepfun_tts_instruction === 'string' ? data.stepfun_tts_instruction : null,
        };
      } else if (event === 'error') {
        streamError = String(data.message ?? 'LLM 流式错误');
      }
    });
    if (streamError) throw new Error(streamError);
    if (result) return result;
    throw new Error('LLM 流式结束但未返回结果');
  }

  const { ok, data, error } = await postLlm<ReplyResult>({ action: 'reply', payload });
  if (!ok || !data) {
    throw new Error(error ?? '角色发言失败');
  }
  return data;
}

/** 旧 4 字段报告（PRD D.2：保留冗余展示） */
export async function generateFeedback(
  topic: string,
  jobTitle: string,
  history: Message[]
): Promise<FeedbackData> {
  const { ok, data, error } = await postLlm<FeedbackData>({
    action: 'feedback',
    payload: {
      topic,
      jobTitle,
      history: history.map((m) => ({ senderId: m.senderId, senderName: m.senderName, content: m.content })),
    },
  });
  if (!ok || !data) {
    throw new Error(error ?? '反馈生成失败');
  }
  return data;
}

/** 报告 v1.5（规则引擎 + LLM 语义分，经 /api/llm analyze action） */
export async function generateInterviewReport(params: {
  format?: InterviewFormat;
  topic: string;
  jobTitle: string;
  messages: Message[];
  events: import('../types').GameEvent[];
  sessionStartAt: number;
  durationMs: number;
  /** 视觉聚合行（本地模式兜底路径也保留视觉维度；服务端路径走 DB） */
  visualRows?: import('../types').VisualFeatureRow[];
  sessionId?: number | null;
}): Promise<InterviewReport> {
  const { ok, data, error } = await postLlm<InterviewReport>({
    action: 'analyze',
    payload: {
      format: params.format ?? 'lgd',
      topic: params.topic,
      jobTitle: params.jobTitle,
      messages: params.messages,
      events: params.events,
      sessionStartAt: params.sessionStartAt,
      durationMs: params.durationMs,
      visual_rows: params.visualRows ?? [],
      session_id: params.sessionId ?? null,
    },
    session_id: params.sessionId ?? null,
  });
  if (!ok || !data) {
    throw new Error(error ?? '报告生成失败');
  }
  return data;
}
