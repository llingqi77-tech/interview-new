import type { GameEvent, Message, MessageSource } from '../../types.ts';
import { estimateSpeechMs } from '../../engine/speechRate.ts';

export interface UserUtterance {
  text: string;
  sentAt: number;
  sessionStartAt: number;
  source: Extract<MessageSource, 'text' | 'realtime'>;
  senderName: string;
  confidence?: number;
}

export interface AiUtterance {
  cardId: string;
  cardName: string;
  content: string;
  startedAt: number;
  endedAt: number;
  sessionStartAt: number;
  emotion?: string;
}

export function buildUserMessage(utterance: UserUtterance): Message {
  const startMs = utterance.sentAt - utterance.sessionStartAt;
  return {
    id: `${utterance.sentAt}-user`,
    senderId: 'user',
    senderName: utterance.senderName,
    content: utterance.text,
    timestamp: utterance.sentAt,
    type: 'message',
    startMs,
    endMs: startMs + estimateSpeechMs(utterance.text),
    confidence: utterance.confidence,
    speaker: 'user',
    source: utterance.source,
  };
}

export function buildAiMessage(utterance: AiUtterance): Message {
  return {
    id: `${utterance.endedAt}-${utterance.cardId}`,
    senderId: utterance.cardId,
    senderName: utterance.cardName,
    content: utterance.content,
    timestamp: utterance.endedAt,
    type: 'message',
    startMs: utterance.startedAt - utterance.sessionStartAt,
    endMs: utterance.endedAt - utterance.sessionStartAt,
    emotion: utterance.emotion,
    speaker: `ai:${utterance.cardId}`,
    source: 'llm',
  };
}

export function speakGrantEvent(actor: string, timestampMs: number): GameEvent {
  return {
    event_type: 'speak_grant',
    actor,
    target: 'all',
    timestamp_ms: timestampMs,
  };
}

export function stageChangeEvent(target: string, timestampMs: number, reason: string): GameEvent {
  return {
    event_type: 'stage_change',
    actor: 'system',
    target,
    timestamp_ms: timestampMs,
    metadata: { reason },
  };
}

export function interruptEvent(actor: string, target: string, timestampMs: number, rule: string): GameEvent {
  return {
    event_type: 'interrupt',
    actor,
    target,
    timestamp_ms: timestampMs,
    metadata: { rule },
  };
}
