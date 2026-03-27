const API_BASE = '/api';

export interface Session {
  id: number;
  company: string;
  job_title: string;
  topic: string;
  status: string;
  created_at: string;
  finished_at?: string;
}

export interface Message {
  id: number;
  session_id: number;
  speaker_type: string;
  speaker_id: string;
  speaker_name: string;
  message: string;
  round: number;
  created_at: string;
}

// 创建新会话
export async function createSession(company: string, jobTitle: string, topic: string, userId?: number | null): Promise<Session> {
  const res = await fetch(`${API_BASE}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company, job_title: jobTitle, topic, user_id: userId }),
  });
  return res.json();
}

// 更新会话状态
export async function updateSessionStatus(sessionId: number, status: string): Promise<Session> {
  const res = await fetch(`${API_BASE}/session`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, status }),
  });
  return res.json();
}

// 保存对话消息
export async function saveMessage(
  sessionId: number,
  speakerType: 'user' | 'ai',
  speakerId: string,
  speakerName: string,
  message: string,
  round: number
): Promise<Message> {
  const res = await fetch(`${API_BASE}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      speaker_type: speakerType,
      speaker_id: speakerId,
      speaker_name: speakerName,
      message,
      round,
    }),
  });
  return res.json();
}

// 获取会话的所有消息
export async function getMessages(sessionId: number): Promise<Message[]> {
  const res = await fetch(`${API_BASE}/message?session_id=${sessionId}`);
  return res.json();
}

// 保存反馈报告
export async function saveFeedback(
  sessionId: number,
  feedback: {
    timing: string;
    voice_share: number;
    structural_contribution: string;
    interruption_handling: string;
    overall_score: number;
    suggestions: string[];
  }
) {
  const res = await fetch(`${API_BASE}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, ...feedback }),
  });
  return res.json();
}

// 获取反馈报告
export async function getFeedback(sessionId: number) {
  const res = await fetch(`${API_BASE}/feedback?session_id=${sessionId}`);
  return res.json();
}
