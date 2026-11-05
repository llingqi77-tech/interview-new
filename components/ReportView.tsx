import React, { lazy, Suspense } from 'react';
import type { Evidence, Message } from '../types';
import { locateEvidence } from '../engine/evidenceLocator';
import type { InterviewReport } from '../engine/reportEngine';
import {
  DIMENSION_CRITERIA,
  DIMENSION_DATA_SOURCES,
  DIMENSION_LABELS,
  dimensionOrder,
  type DimensionId,
} from '../engine/scoring';
import { REPORT_ACTIONS, VISUAL_NOT_ENABLED_TEXT } from '../engine/reportCopy';
import { isCertConfigured } from '../src/onchain/config';
import { useWalletIdentity } from '../src/wallet/context';

/** 铸证卡片按需加载（未配置链上组件时不进入 bundle） */
const CertificateSection = lazy(() => import('./CertificateSection'));

/**
 * 面后报告（PRD 7. 报告输出形式）
 * 综合得分环形图 + 分维度进度条 + 指标标签 + 证据引用（带时间戳，可点击定位）+ 改进建议编号列表
 */

export interface ReportViewProps {
  report: InterviewReport | null;
  /** 生成失败时的错误文案 */
  error?: string | null;
  onRetry?: () => void;
  onRestart: () => void;
  onDelete: () => void;
  /** 点击证据定位到对应发言 */
  onLocate?: (messageIndex: number) => void;
  /** 本场转写（用于证据定位弹层） */
  messages?: Message[];
}

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const ScoreRing: React.FC<{ score: number; band: string }> = ({ score, band }) => {
  const offset = RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, score)) / 100);
  return (
    <div className="relative w-40 h-40" data-testid="score-ring" data-score={score}>
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={RING_RADIUS}
          fill="none"
          stroke="url(#scoreGradient)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
        />
        <defs>
          <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22D3EE" />
            <stop offset="100%" stopColor="#A78BFA" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold text-white">{score}</span>
        <span className="text-xs text-white/60 mt-1">{band}</span>
      </div>
    </div>
  );
};

const EvidenceList: React.FC<{ items: Evidence[]; onLocate?: (i: number) => void }> = ({ items, onLocate }) => {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {items.map((ev) => (
        <li key={ev.id}>
          <button
            type="button"
            data-testid="evidence-item"
            data-message-index={ev.message_index ?? -1}
            onClick={() => {
              if (typeof ev.message_index === 'number') onLocate?.(ev.message_index);
            }}
            className="text-left text-xs text-white/70 hover:text-white transition-colors"
          >
            <span className="text-brand mr-2">[{formatTimestamp(ev.timestamp_ms)}]</span>
            <span>「{ev.content}」</span>
          </button>
        </li>
      ))}
    </ul>
  );
};

const DimensionRow: React.FC<{
  id: DimensionId;
  dim: InterviewReport['dimensions'][string];
  weight: number;
  onLocate?: (i: number) => void;
}> = ({ id, dim, weight, onLocate }) => {
  const disabled = dim.status === 'not_enabled';
  return (
    <div className="glass-panel p-4" data-testid="dimension-row" data-dimension={id}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-white">{DIMENSION_LABELS[id]}</span>
          <span className="text-[11px] text-white/40">权重 {weight}%</span>
        </div>
        <span className="text-sm text-white/80">
          {disabled ? VISUAL_NOT_ENABLED_TEXT : `${dim.score} / ${dim.max}`}
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden" data-testid="dimension-bar">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400"
          style={{ width: `${disabled ? 0 : dim.score}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-white/45">{DIMENSION_CRITERIA[id]}</p>
      <p className="text-[11px] text-white/30">数据依据：{DIMENSION_DATA_SOURCES[id]}</p>
      {dim.metrics && Object.keys(dim.metrics).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(dim.metrics).map(([k, v]) => (
            <span key={k} className="glass-chip text-[10px] px-2 py-0.5" data-testid="metric-tag">
              {k} {String(v)}
            </span>
          ))}
        </div>
      )}
      {dim.note && <p className="mt-2 text-[11px] text-amber-200/70">{dim.note}</p>}
      <EvidenceList items={dim.evidence} onLocate={onLocate} />
    </div>
  );
};

const ReportView: React.FC<ReportViewProps> = ({ report, error, onRetry, onRestart, onDelete, onLocate, messages }) => {
  const wallet = useWalletIdentity();
  const [located, setLocated] = React.useState<Evidence | null>(null);
  const locatedView = located && messages ? locateEvidence(messages, located) : null;
  const handleLocate = (index: number) => {
    onLocate?.(index);
    if (!messages) return;
    const dims: Record<string, { evidence: Evidence[] }> = report?.dimensions ?? {};
    const ev = Object.values(dims)
      .flatMap((d) => d.evidence)
      .find((e) => e.message_index === index);
    if (ev) setLocated(ev);
  };
  if (!report) {
    return (
      <div className="glass-panel p-8 text-center">
        <h2 className="text-xl font-bold text-red-300 mb-3">评估报告生成失败</h2>
        <p className="text-white/60 mb-6">{error || '请检查网络后重试'}</p>
        <div className="flex items-center justify-center gap-3">
          {onRetry && (
            <button type="button" onClick={onRetry} className="glass-btn-primary px-5 py-2">
              {REPORT_ACTIONS.retry}
            </button>
          )}
          <button type="button" onClick={onRestart} className="glass-btn px-5 py-2">
            {REPORT_ACTIONS.home}
          </button>
        </div>
      </div>
    );
  }

  const order = dimensionOrder(report.format ?? 'lgd');

  return (
    <div className="space-y-5">
      <div className="glass-panel p-6 flex flex-col md:flex-row items-center gap-6">
        <ScoreRing score={report.overall_score} band={report.band} />
        <div className="flex-1">
          <h2 className="text-lg font-bold text-white">面试评估报告</h2>
          {report.core_focus && <p className="text-sm text-white/60 mt-1">{report.core_focus}</p>}
          {report.band_advice && <p className="text-sm text-white/70 mt-2">{report.band_advice}</p>}
          <div className="flex flex-wrap gap-2 mt-4">
            <button type="button" onClick={onRestart} className="glass-btn-primary text-sm px-4 py-1.5">
              {REPORT_ACTIONS.restart}
            </button>
            <button type="button" onClick={onDelete} className="glass-btn-ghost text-sm px-4 py-1.5">
              {REPORT_ACTIONS.delete}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {order.map((id) => (
          <DimensionRow
            key={id}
            id={id}
            dim={report.dimensions[id]}
            weight={Math.round((report.weights?.[id] ?? 0) * 10) / 10}
            onLocate={handleLocate}
          />
        ))}
      </div>

      {locatedView && (
        <div
          className="glass-modal-backdrop"
          data-testid="evidence-locate"
          onClick={() => setLocated(null)}
          role="presentation"
        >
          <div className="glass-modal max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="font-bold text-white mb-2">定位到原话</h3>
            {locatedView.message ? (
              <div className="space-y-2">
                {locatedView.context.map((m, i) => (
                  <div
                    key={`${m.id}-${i}`}
                    className={`text-sm rounded-lg px-3 py-2 ${
                      m === locatedView.message ? 'bg-cyan-400/15 text-white' : 'text-white/55'
                    }`}
                  >
                    <span className="text-[10px] text-white/40 mr-2">
                      {m.senderId === 'user' ? '我' : m.senderName} · {formatTimestamp(m.startMs ?? m.timestamp)}
                    </span>
                    {m.content}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/60">{locatedView.fallback}</p>
            )}
            <button type="button" onClick={() => setLocated(null)} className="glass-btn mt-4 px-4 py-2 text-sm">
              关闭
            </button>
          </div>
        </div>
      )}

      {isCertConfigured() && wallet.configured && !wallet.isLoading && (
        <Suspense fallback={null}>
          <CertificateSection report={report} />
        </Suspense>
      )}

      <div className="glass-panel p-6">
        <h3 className="font-semibold text-white mb-3">改进建议</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-white/75">
          {(report.suggestions ?? []).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
    </div>
  );
};

export default ReportView;
