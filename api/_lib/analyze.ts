import type { Pool } from 'pg';
import type { GameEvent, InterviewFormat, Message, VisualFeatureRow } from '../../types';
import { buildReport, collectEvidence, type InterviewReport, type SemanticScores } from '../../engine/reportEngine.ts';
import { summarizeVisual } from '../../engine/visionMetrics.ts';
import { callDeepSeek } from './llm.ts';
import { buildAnalysisPrompt } from './prompts.ts';
import { safeJsonParse } from './jsonStream.ts';

/**
 * 面后分析流水线（PRD 7.6 / E.2）
 * runAnalysis = 规则引擎 + LLM 语义分（两条路径共用，杜绝行为漂移）：
 *   - analyzeSession：/api/sessions/{id}/analyze，读 DB（transcripts/events/visual_features）→ 落库
 *   - /api/llm action=analyze：客户端兜底（本地模式），数据由请求体携带
 * 目标 ≤30s（C8）：规则引擎毫秒级 + 单次 DeepSeek 调用秒级。
 */

export interface AnalyzeInput {
  format?: InterviewFormat;
  topic: string;
  transcripts: Message[];
  events: GameEvent[];
  sessionStartAt: number;
  durationMs: number;
  /** 视觉聚合行（服务端路径来自 visual_features；客户端兜底路径由会话内存传入） */
  visualRows?: VisualFeatureRow[];
}

export interface AnalyzeResult {
  report: InterviewReport;
  persisted: boolean;
}

/** 规则引擎 + LLM 语义分 → 面后报告（不落库） */
export async function runAnalysis(input: AnalyzeInput): Promise<InterviewReport> {
  const { format = 'lgd', topic, transcripts, events, sessionStartAt, durationMs, visualRows } = input;

  const userTranscripts = transcripts
    .filter((m) => m.senderId === 'user' && m.type === 'message')
    .map((m) => ({ content: m.content, timestampMs: Math.max(0, m.timestamp - sessionStartAt) }));

  let semantic: SemanticScores | undefined;
  if (userTranscripts.length > 0) {
    try {
      const full = await callDeepSeek(buildAnalysisPrompt(topic, userTranscripts), 0.3);
      const parsed = safeJsonParse<{ scores?: SemanticScores }>(full);
      if (parsed?.scores) semantic = parsed.scores;
    } catch (err) {
      console.error('analyzeSession LLM 失败，退回规则引擎:', err);
    }
  }

  const visualStats = visualRows && visualRows.length > 0 ? summarizeVisual(visualRows) : undefined;
  return buildReport({
    format,
    transcripts,
    events,
    sessionStartAt,
    durationMs,
    semantic,
    visualEnabled: Boolean(visualStats),
    visualStats,
  });
}

/** DB 行 → Message（字段与 transcripts/conversation_records 双 schema 对齐） */
function rowToMessage(r: any, i: number, sessionStartAt: number): Message {
  const isUser = r.speaker === 'user' || r.speaker_type === 'user';
  return {
    id: String(r.id ?? i),
    senderId: isUser ? 'user' : String(r.speaker_id ?? r.speaker ?? 'ai'),
    senderName: r.speaker_name ?? (isUser ? '陈明' : 'AI'),
    content: r.message ?? '',
    timestamp: r.created_at ? new Date(r.created_at).getTime() : sessionStartAt,
    type: 'message' as const,
    startMs: r.start_ms ?? undefined,
    endMs: r.end_ms ?? undefined,
    confidence: r.confidence ?? undefined,
    stepfunSegmentId: r.stepfun_segment_id ?? undefined,
  };
}

export async function analyzeSession(
  pool: Pool,
  sessionId: number,
  opts: { persist?: boolean } = {}
): Promise<AnalyzeResult> {
  // 会话不存在 → 直接报错（不吞异常：否则会给不存在的会话编出一份分数）
  const sessionRes = await pool.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
  const session = sessionRes.rows[0];
  if (!session) {
    const err = new Error(`会话不存在：${sessionId}`);
    (err as { code?: string }).code = 'SESSION_NOT_FOUND';
    throw err;
  }
  const topic = session.topic ?? '';

  let transcriptRows: any[] = [];
  try {
    const res = await pool.query('SELECT * FROM transcripts WHERE session_id = $1 ORDER BY created_at ASC', [sessionId]);
    transcriptRows = res.rows;
  } catch {
    const res = await pool.query('SELECT * FROM conversation_records WHERE session_id = $1 ORDER BY created_at ASC', [sessionId]);
    transcriptRows = res.rows;
  }
  let eventRows: any[] = [];
  try {
    const res = await pool.query('SELECT * FROM events WHERE session_id = $1 ORDER BY timestamp_ms ASC', [sessionId]);
    eventRows = res.rows;
  } catch {
    eventRows = [];
  }
  // 视觉聚合特征（M6）：表不存在/空表时容忍，视觉维度自动 not_enabled
  let visualRows: VisualFeatureRow[] = [];
  try {
    const res = await pool.query(
      'SELECT timestamp_ms, eye_contact, emotion, head_pose, engagement FROM visual_features WHERE session_id = $1 ORDER BY timestamp_ms ASC',
      [sessionId]
    );
    visualRows = res.rows;
  } catch {
    visualRows = [];
  }

  const sessionStartAt = session?.started_at ? new Date(session.started_at).getTime() : Date.now();
  const endedAt = session?.ended_at ? new Date(session.ended_at).getTime() : Date.now();
  const durationMs = Math.max(60_000, endedAt - sessionStartAt);

  const transcripts: Message[] = transcriptRows.map((r, i) => rowToMessage(r, i, sessionStartAt));
  const events: GameEvent[] = eventRows.map((r) => ({
    event_type: r.event_type,
    actor: r.actor,
    target: r.target,
    timestamp_ms: r.timestamp_ms,
    metadata: r.metadata ?? {},
  }));

  const format: InterviewFormat = (session?.format as InterviewFormat) ?? 'lgd';
  const report = await runAnalysis({ format, topic, transcripts, events, sessionStartAt, durationMs, visualRows });
  report.session_id = sessionId;

  let persisted = false;
  if (opts.persist !== false) {
    try {
      await pool.query(
        // 幂等：先清掉该会话的旧报告再写入（重复触发覆盖，而不是追加多行）
        `WITH cleared AS (DELETE FROM reports WHERE session_id = $1)
         INSERT INTO reports (session_id, overall_score, dimension_scores, evidence_pool, suggestions)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          sessionId,
          report.overall_score,
          JSON.stringify(report.dimensions),
          JSON.stringify(collectEvidence(report)),
          JSON.stringify(report.suggestions),
        ]
      );
      persisted = true;
    } catch (err) {
      console.error('reports 落库失败:', err);
    }
  }

  return { report, persisted };
}
