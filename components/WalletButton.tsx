import React, { useEffect, useRef, useState } from 'react';
import { useWalletIdentity } from '../src/wallet/context';
import { shortAddress } from '../src/wallet/config';

/**
 * 钱包连接按钮（Q-N1：Para 嵌入式钱包地址 = 免登录用户标识）
 * 未配置 VITE_PARA_API_KEY 时不渲染（应用保持匿名可用）。
 */
const WalletButton: React.FC = () => {
  const { configured, isConnected, isLoading, address, source, connect, disconnect } = useWalletIdentity();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (!configured) return null;

  if (isLoading) {
    return <span className="text-sm text-muted">钱包加载中…</span>;
  }

  if (!isConnected || !address) {
    return (
      <button
        onClick={connect}
        className="glass-btn-primary text-sm px-3 py-1.5"
      >
        连接钱包
      </button>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用（非安全上下文）时静默
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="glass-btn-ghost text-sm px-3 py-1.5"
      >
        <span className="w-2 h-2 rounded-full bg-success" aria-hidden />
        <span className="font-mono text-ink">{shortAddress(address)}</span>
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-subtle text-info border border-line">
          Monad Testnet
        </span>
      </button>
      {open && (
        <div className="glass-dock rounded-2xl absolute right-0 mt-2 w-56 p-3 z-50">
          <div className="text-xs text-muted mb-1">
            {source === 'embedded' ? 'Para 嵌入式钱包' : '外部钱包'} · 已连接
          </div>
          <div className="font-mono text-xs break-all text-ink mb-3">{address}</div>
          <div className="flex gap-2">
            <button
              onClick={copy}
              className="glass-btn-ghost flex-1 text-xs px-2 py-1.5"
            >
              {copied ? '已复制 ✓' : '复制地址'}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                disconnect();
              }}
              className="glass-btn-danger flex-1 text-xs px-2 py-1.5"
            >
              断开
            </button>
          </div>
          <div className="mt-2 text-xs text-muted">
            该地址将作为你的练习记录标识（Q-N1），历史与报告按地址归档
          </div>
        </div>
      )}
    </div>
  );
};

export default WalletButton;
