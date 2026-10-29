import type { InterviewFormat, RoleCard } from '../types.ts';

/**
 * 个人陈述顺序。
 * panel：只有候选人自我介绍。
 * lgd：3 名 AI + 用户，用户位置由 random 决定，避免固定垫底。
 */
export function buildOpeningOrder(
  cards: readonly Pick<RoleCard, 'id'>[],
  format: InterviewFormat,
  random: () => number = Math.random,
): string[] {
  if (format === 'panel') return ['user'];
  const order = cards.map((card) => card.id).filter((id) => id.length > 0);
  const span = order.length + 1;
  const raw = random();
  const insertAt = Number.isFinite(raw) ? Math.min(order.length, Math.max(0, Math.floor(raw * span))) : order.length;
  order.splice(insertAt, 0, 'user');
  return order;
}
