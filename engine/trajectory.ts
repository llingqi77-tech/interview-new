import type { Message } from '../types.ts';

/**
 * 发言轨迹条（PRD 4.：最近 50 次发言的迷你轨迹图 + 发言总数）
 */

export const TRAJECTORY_WINDOW = 50;

export interface TrajectoryPoint {
  speakerId: string;
  speakerName: string;
  isUser: boolean;
  startMs: number;
  durationMs: number;
}

export interface TrajectoryState {
  /** 最近 TRAJECTORY_WINDOW 次发言（时间正序） */
  points: TrajectoryPoint[];
  /** 全场发言总数（不受窗口限制） */
  total: number;
  /** 真人发言占比 0-1（按条数） */
  userShare: number;
}

function durationOf(msg: Message): number {
  if (typeof msg.startMs === 'number' && typeof msg.endMs === 'number' && msg.endMs > msg.startMs) {
    return msg.endMs - msg.startMs;
  }
  return Math.max(800, msg.content.length * 180);
}

/** 只统计真实发言（system 提示与引导语不计入轨迹） */
export function buildTrajectory(messages: Message[]): TrajectoryState {
  const spoken = messages.filter((m) => m.type === 'message' && m.content.trim().length > 0);
  const points: TrajectoryPoint[] = spoken.map((m) => ({
    speakerId: m.senderId,
    speakerName: m.senderName,
    isUser: m.senderId === 'user',
    startMs: m.startMs ?? m.timestamp,
    durationMs: durationOf(m),
  }));
  const userCount = points.filter((p) => p.isUser).length;
  return {
    points: points.slice(-TRAJECTORY_WINDOW),
    total: points.length,
    userShare: points.length ? userCount / points.length : 0,
  };
}
