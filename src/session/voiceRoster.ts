import type { InterviewFormat, RoleCard } from '../../types.ts';
import { HOST_CARD } from '../../data/interviewerCards.ts';
import type { VoiceSpeaker } from '../../services/realtimeVoiceRouter.ts';

/**
 * 本场要出声的角色。
 * 无领导讨论把主持加进去；结构化单面只有面试官。
 * 同一 id 只保留第一张卡，避免重复建分路。
 */
export function collectVoiceSpeakers(format: InterviewFormat, roles: readonly RoleCard[]): VoiceSpeaker[] {
  const cards = format === 'lgd' ? [...roles, HOST_CARD] : [...roles];
  const seen = new Set<string>();
  const speakers: VoiceSpeaker[] = [];
  for (const card of cards) {
    if (!card?.id || seen.has(card.id)) continue;
    seen.add(card.id);
    speakers.push({ roleId: card.id, name: card.name, voice: card.voice });
  }
  return speakers;
}
