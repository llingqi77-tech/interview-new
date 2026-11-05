import { fetchWithTimeout } from '../services/http.ts';

const API_BASE = '/api';

/** 持久化接口超时：数据库不可达时不能把用户卡在设备检测页 */
const API_TIMEOUT_MS = 8000;

/**
 * 持久化客户端（PRD 4.1.4 / 4.1.9 / E.1-E.2）
 * 数据库未配置时各接口返回 503，调用方按「本地模式」降级，不阻断模拟。
 */

export interface Session {
  id: number;
  company: string;
  job_title: string;
  topic: string;
  topic_type?: string;
  roles?: unknown;
  voice_enabled?: boolean;
  camera_enabled?: boolean;
  status: string;
  created_at: string;
  started_at?: string;
  ended_at?: string;
  finished_at?: string;
  wallet_address?: string | null;
}

export interface MessageRecord {
  id: number;
  session_id: number;
  speaker?: string;
  speaker_type: string;
  speaker_id: string;
  speaker_name: string;
  message: string;
  round: number;
  start_ms?: number | null;
  end_ms?: number | null;
  confidence?: number | null;
  created_at: string;
}

async function parseJson<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// 创建会话（roles 为角色卡 id 列表）
export async function createSession(params: {
  company: string;
  jobTitle: string;
  topic: string;
  topicType?: string;
  roles?: string[];
  /** 群面阵型：lgd（默认）| panel */
  format?: string;
  voiceEnabled?: boolean;
  cameraEnabled?: boolean;
  userId?: number | null;
  /** Q-N1：Para 钱包地址（0x…42 字符），免登录用户标识；匿名时传 null */
  walletAddress?: string | null;
}): Promise<Session | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: params.company,
        job_title: params.jobTitle,
        topic: params.topic,
        topic_type: params.topicType ?? 'business_case',
        roles: params.roles ?? [],
        format: params.format ?? 'lgd',
        voice_enabled: params.voiceEnabled ?? false,
        camera_enabled: params.cameraEnabled ?? false,
        user_id: params.userId ?? null,
        wallet_address: params.walletAddress ?? null,
      }),
    },
      API_TIMEOUT_MS
    );
    if (!res.ok) return null;
    return await parseJson<Session>(res);
  } catch {
    return null; // 本地模式：无数据库也能模拟
  }
}

export async function updateSessionStatus(sessionId: number, status: string): Promise<Session | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/session`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, status }),
    },
      API_TIMEOUT_MS
    );
    if (!res.ok) return null;
    return await parseJson<Session>(res);
  } catch {
    return null;
  }
}

// 删除会话及全部记录（隐私：TC-11 不可恢复）
export async function deleteSession(sessionId: number): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/session`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    },
      API_TIMEOUT_MS
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function saveMessage(params: {
  sessionId: number;
  speaker: string;
  speakerType: 'user' | 'ai';
  speakerId: string;
  speakerName: string;
  message: string;
  round: number;
  startMs?: number;
  endMs?: number;
  confidence?: number;
  stepfunSegmentId?: string | null;
}): Promise<MessageRecord | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: params.sessionId,
        speaker: params.speaker,
        speaker_type: params.speakerType,
        speaker_id: params.speakerId,
        speaker_name: params.speakerName,
        message: params.message,
        round: params.round,
        start_ms: params.startMs,
        end_ms: params.endMs,
        confidence: params.confidence,
        stepfun_segment_id: params.stepfunSegmentId ?? null,
      }),
    });
    if (!res.ok) return null;
    return await parseJson<MessageRecord>(res);
  } catch {
    return null;
  }
}

export async function getMessages(sessionId: number): Promise<MessageRecord[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/message?session_id=${sessionId}`);
    if (!res.ok) return [];
    return (await parseJson<MessageRecord[]>(res)) ?? [];
  } catch {
    return [];
  }
}

// 事件日志批量入库（PRD 4.1.4）
export async function saveEvents(
  sessionId: number,
  events: import('../types').GameEvent[]
): Promise<boolean> {
  if (!sessionId || events.length === 0) return false;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, events }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// 视觉聚合特征批量入库（M6：每秒一条，PRD D.4；聚合数值/枚举才离开浏览器）
export async function saveVisualFeatures(
  sessionId: number,
  rows: import('../types').VisualFeatureRow[]
): Promise<boolean> {
  if (!sessionId || rows.length === 0) return false;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}/visual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, rows }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// 保存报告 v1.5（reports JSONB 列）
export async function saveReport(params: {
  sessionId: number;
  report: import('../types').InterviewReport;
  legacy?: import('../types').FeedbackData;
}): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: params.sessionId,
        overall_score: params.report.overall_score,
        dimension_scores: params.report.dimensions,
        evidence_pool: Object.values(params.report.dimensions).flatMap((d) => d.evidence),
        suggestions: params.report.suggestions,
        timing: params.legacy?.timing ?? null,
        voice_share: params.legacy?.voiceShare ?? null,
        structural_contribution: params.legacy?.structuralContribution ?? null,
        interruption_handling: params.legacy?.interruptionHandling ?? null,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getFeedback(sessionId: number) {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/feedback?session_id=${sessionId}`);
    if (!res.ok) return null;
    return await parseJson<unknown>(res);
  } catch {
    return null;
  }
}

// 触发服务端面后分析（/api/sessions/{id}/analyze）
export async function triggerAnalyze(sessionId: number): Promise<import('../types').InterviewReport | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}/analyze`, { method: 'POST' });
    if (!res.ok) return null;
    return await parseJson<import('../types').InterviewReport>(res);
  } catch {
    return null;
  }
}

// 预设形象列表
export async function getAvatarPresets(): Promise<import('../types').AvatarPreset[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/avatars/presets`);
    if (!res.ok) return [];
    const data = await parseJson<{ presets: import('../types').AvatarPreset[] }>(res);
    return data?.presets ?? [];
  } catch {
    return [];
  }
}
