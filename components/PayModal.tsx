import React, { useEffect, useState } from 'react';
import {
  createPayOrder,
  getPayCatalog,
  submitPaymentForm,
  type PayCatalog,
  type PaySku,
} from '../src/pay';

/**
 * 购买弹窗（支付宝 AI 网页应用收款）
 *
 * 只负责「选商品 → 下单 → 提交支付宝表单」。
 * 支付结果不在这里判定：用户付完款由支付宝异步通知推进订单状态，
 * 前端回到应用后调 waitForPaid / listPayOrders 查真实状态。
 */

interface PayModalProps {
  open: boolean;
  onClose: () => void;
  /** Para 钱包地址（可选，用于把订单归档到用户） */
  walletAddress?: string | null;
  /** 关联的练习场次（可选） */
  sessionId?: number | null;
}

const PayModal: React.FC<PayModalProps> = ({ open, onClose, walletAddress, sessionId }) => {
  const [catalog, setCatalog] = useState<PayCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [payingSku, setPayingSku] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPayCatalog()
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setError('支付服务不可用（/api/pay 无响应）');
          return;
        }
        setCatalog(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const handleBuy = async (sku: PaySku) => {
    setPayingSku(sku.sku);
    setError(null);
    try {
      const order = await createPayOrder({ sku: sku.sku, walletAddress, sessionId });
      // 把支付宝返回的表单渲染并自动提交（不能当 URL 跳转）
      submitPaymentForm(order.payment_html);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setPayingSku(null);
    }
  };

  const configured = catalog?.alipay.configured ?? false;
  const dbReady = catalog?.database ?? false;

  return (
    <div className="glass-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="glass-modal p-6 max-w-lg w-full mx-4"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="购买练习次数"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">购买练习次数</h2>
            <p className="text-xs text-white/50 mt-1">支付宝安全支付 · 付款后次数自动到账</p>
          </div>
          <button onClick={onClose} className="glass-btn-ghost text-sm px-2 py-1" aria-label="关闭">
            ✕
          </button>
        </div>

        {loading && <p className="text-sm text-white/60 py-6 text-center">加载中…</p>}

        {!loading && !configured && (
          <div className="glass-chip badge-warning text-xs px-3 py-2 mb-4 block">
            服务端尚未配置支付宝密钥（ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY），
            支付暂不可用。配置步骤见 docs/alipay-aipay.md。
          </div>
        )}

        {!loading && configured && !dbReady && (
          <div className="glass-chip badge-warning text-xs px-3 py-2 mb-4 block">
            服务端未配置 DATABASE_URL，订单无法落库，支付暂不可用。
          </div>
        )}

        {error && (
          <div className="glass-chip badge-danger text-xs px-3 py-2 mb-4 block">{error}</div>
        )}

        {!loading && catalog && catalog.skus.length > 0 && (
          <div className="space-y-3">
            {catalog.skus.map((sku) => (
              <button
                key={sku.sku}
                onClick={() => handleBuy(sku)}
                disabled={!configured || !dbReady || payingSku !== null}
                className="glass-card glass-card-hover w-full text-left p-4 flex items-center justify-between disabled:opacity-50"
              >
                <div>
                  <div className="text-sm font-medium text-white">{sku.subject}</div>
                  {sku.description && (
                    <div className="text-xs text-white/50 mt-1">{sku.description}</div>
                  )}
                </div>
                <div className="text-right shrink-0 ml-4">
                  <div className="text-base font-semibold text-gradient-brand">¥{sku.amount}</div>
                  <div className="text-[11px] text-white/40 mt-0.5">
                    {payingSku === sku.sku ? '跳转中…' : '去支付'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {!loading && catalog && catalog.skus.length === 0 && (
          <p className="text-sm text-white/60 py-6 text-center">商品目录为空，请检查 api/_lib/payCatalog.ts</p>
        )}

        {catalog?.alipay.sandbox && (
          <p className="text-[11px] text-white/40 mt-4 text-center">当前为支付宝沙箱环境，不会产生真实扣款</p>
        )}
      </div>
    </div>
  );
};

export default PayModal;
