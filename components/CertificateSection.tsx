import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { encodeFunctionData, formatEther } from 'viem';
import {
  useBalance,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { monadTestnet } from 'wagmi/chains';
import type { InterviewReport } from '../types';
import { useWalletIdentity } from '../src/wallet/context';
import {
  CERT_ADDRESS,
  ENVIO_GRAPHQL_URL,
  MONAD_FAUCET_URL,
  MONAD_TESTNET_CHAIN_ID,
  MINT_GAS_FALLBACK,
  explorerContractUrl,
  explorerTxUrl,
  isEnvioConfigured,
} from '../src/onchain/config';
import { interviewCertificateAbi as abi } from '../src/onchain/abi';
import { CERT_APP_ID, CERT_PAYLOAD_VERSION, buildReportHash } from '../src/onchain/reportHash';

/**
 * 链上证书（InterviewCertificate soulbound NFT，Monad Testnet）
 *
 * 报告页内嵌卡片：付费铸造报告哈希承诺 → 不可转让证书。
 * 仅在 VITE_CERT_ADDRESS 配置且 Para 钱包层就绪时由 EvidenceReport 懒加载渲染，
 * wagmi/viem 运行时代码因此不进主 bundle（与 ParaWalletProviderInner 同 pattern）。
 *
 * Monad 差异（monskills gas/）：按 gas_limit 计费 —— 铸造前 estimateGas + 10% buffer，
 * 估算失败才回落 MINT_GAS_FALLBACK，不让用户为虚高的 limit 付费。
 */

interface IndexedCertificate {
  id: string;
  tokenId: string;
  reportHash: string;
  paidAmount: string;
  txHash?: string | null;
}

const shortHash = (h: string): string => `${h.slice(0, 10)}…${h.slice(-4)}`;

const CertificateSection: React.FC<{ report: InterviewReport }> = ({ report }) => {
  const identity = useWalletIdentity();
  const address = (identity.address ?? null) as `0x${string}` | null;
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: MONAD_TESTNET_CHAIN_ID });

  const reportHash = useMemo(
    () =>
      address
        ? buildReportHash({ v: CERT_PAYLOAD_VERSION, app: CERT_APP_ID, minter: address, report })
        : null,
    [address, report]
  );

  const readsEnabled = Boolean(address && reportHash);
  const certAddress = CERT_ADDRESS as `0x${string}`;

  const { data: mintPrice } = useReadContract({
    address: certAddress,
    abi,
    functionName: 'mintPrice',
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: readsEnabled },
  });

  const { data: existingTokenId, refetch: refetchExisting } = useReadContract({
    address: certAddress,
    abi,
    functionName: 'certificateOfReport',
    args: reportHash ? [reportHash] : undefined,
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: readsEnabled },
  });

  const { data: balance } = useBalance({
    address: address ?? undefined,
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  const {
    writeContract,
    data: txHash,
    isPending: signing,
    error: writeError,
  } = useWriteContract();
  const { isLoading: confirming, isSuccess: mined } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: MONAD_TESTNET_CHAIN_ID,
  });

  // 交易上链后延迟刷新查重读（等 RPC/索引状态跟上）
  useEffect(() => {
    if (!mined) return;
    const t = setTimeout(() => void refetchExisting(), 1500);
    return () => clearTimeout(t);
  }, [mined, refetchExisting]);

  const onMint = useCallback(async () => {
    if (!address || !reportHash) return;
    const price = mintPrice ?? 0n;
    let gas = MINT_GAS_FALLBACK;
    if (publicClient) {
      try {
        const est = await publicClient.estimateGas({
          account: address,
          to: certAddress,
          data: encodeFunctionData({ abi, functionName: 'mintCertificate', args: [reportHash] }),
          value: price,
        });
        gas = est + est / 10n; // gas skill：buffer 最多 10%，limit 即花费
      } catch {
        // 估算 revert（余额不足/重复铸造等）→ 用实测兜底值，让用户在钱包里看到真实 revert
      }
    }
    // wagmi v3：writeContract 变量必须显式带 account / chain（见 @wagmi/core WriteContractParameters）
    writeContract({
      account: address,
      chain: monadTestnet,
      address: certAddress,
      abi,
      functionName: 'mintCertificate',
      args: [reportHash],
      value: price,
      gas,
    });
  }, [address, reportHash, mintPrice, publicClient, certAddress, writeContract]);

  // ---- 我的链上证书（Envio HyperIndex，未配置端点时整段隐藏） ----
  const [indexed, setIndexed] = useState<IndexedCertificate[] | null>(null);
  useEffect(() => {
    if (!isEnvioConfigured() || !address) return;
    let cancelled = false;
    const query = `query MyCertificates($recipient: String!) {
  Certificate(where: { recipient: { _eq: $recipient } }, order_by: { tokenId: desc }, limit: 20) {
    id tokenId reportHash paidAmount txHash
  }
}`;
    fetch(ENVIO_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { recipient: address } }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setIndexed((j?.data?.Certificate as IndexedCertificate[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setIndexed(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address, mined]);

  const alreadyMinted = typeof existingTokenId === 'bigint' && existingTokenId > 0n;
  const wrongChain = Boolean(address) && chainId !== MONAD_TESTNET_CHAIN_ID;
  const priceUnknown = mintPrice === undefined;
  const insufficient =
    !priceUnknown && balance !== undefined && balance.value < (mintPrice as bigint);
  const busy = signing || confirming || switching;

  return (
    <div className="glass-card p-5 mb-8 border-violet-400/25 bg-violet-400/[0.08]">
      <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
        <span aria-hidden>⛓️</span>链上证书
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-400/15 text-violet-300 border border-violet-400/30">
          Monad Testnet
        </span>
      </h3>
      <p className="text-xs text-white/50 mb-4 leading-relaxed">
        将本报告的哈希承诺铸造为不可转让证书（soulbound NFT）。任何人拿到报告原文与你的地址，
        都能复算哈希并在链上验真，证书不可转卖、不可伪造。
      </p>

      {!address && (
        <div className="flex items-center justify-between gap-3 bg-white/[0.06] rounded-xl border border-white/10 px-4 py-3">
          <span className="text-sm text-white/70">连接钱包后即可铸造本报告的链上证书</span>
          <button
            onClick={identity.connect}
            className="glass-btn-primary text-sm px-3 py-1.5 shrink-0"
          >
            连接钱包
          </button>
        </div>
      )}

      {address && alreadyMinted && (
        <div className="badge-success rounded-xl px-4 py-3">
          <div className="text-sm font-bold text-emerald-300">
            ✓ 本报告已上链存证 · 证书 #{(existingTokenId as bigint).toString()}
          </div>
          <div className="text-xs text-white/50 mt-1 font-mono">
            reportHash: {reportHash ? shortHash(reportHash) : '—'}
          </div>
          <a
            href={explorerContractUrl()}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-violet-300 hover:text-violet-200 hover:underline mt-1 inline-block"
          >
            在 Monad Explorer 查看合约 ↗
          </a>
        </div>
      )}

      {address && !alreadyMinted && (
        <div className="bg-white/[0.06] rounded-xl border border-white/10 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/70">铸造费用</span>
            <span className="font-mono font-bold text-white tabular-nums">
              {priceUnknown ? '读取中…' : `${formatEther(mintPrice as bigint)} MON`}
            </span>
          </div>
          {balance !== undefined && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">钱包余额</span>
              <span className={`font-mono tabular-nums ${insufficient ? 'text-red-300 font-bold' : 'text-white/60'}`}>
                {Number(formatEther(balance.value)).toFixed(4)} MON
              </span>
            </div>
          )}
          {reportHash && (
            <div className="text-[10px] text-white/40 font-mono">reportHash: {shortHash(reportHash)}</div>
          )}

          {insufficient && (
            <div className="badge-danger text-xs rounded-lg px-3 py-2">
              MON 余额不足支付铸造费。
              <a href={MONAD_FAUCET_URL} target="_blank" rel="noreferrer" className="underline ml-1">
                去官方水龙头领取测试 MON ↗
              </a>
            </div>
          )}

          {wrongChain ? (
            <button
              onClick={() => switchChain({ chainId: MONAD_TESTNET_CHAIN_ID })}
              disabled={busy}
              className="w-full py-2.5 rounded-xl bg-amber-400/20 border border-amber-400/40 text-amber-200 text-sm font-bold hover:bg-amber-400/30 disabled:opacity-50 transition-colors"
            >
              {switching ? '切换中…' : '切换到 Monad Testnet'}
            </button>
          ) : (
            <button
              onClick={() => void onMint()}
              disabled={busy || priceUnknown || insufficient}
              className="glass-btn-primary w-full py-2.5 rounded-xl text-sm font-bold"
            >
              {signing
                ? '等待钱包签名…'
                : confirming
                  ? '链上确认中（Monad 约 1 秒）…'
                  : '铸造链上证书'}
            </button>
          )}

          {mined && txHash && (
            <div className="badge-success text-xs rounded-lg px-3 py-2">
              ✓ 铸造成功，证书归属当前钱包。
              <a
                href={explorerTxUrl(txHash)}
                target="_blank"
                rel="noreferrer"
                className="underline ml-1"
              >
                查看交易 ↗
              </a>
            </div>
          )}

          {writeError && !signing && (
            <div className="badge-danger text-xs rounded-lg px-3 py-2 break-all">
              {(writeError as { shortMessage?: string }).shortMessage ?? writeError.message.slice(0, 160)}
            </div>
          )}
        </div>
      )}

      {address && isEnvioConfigured() && indexed && indexed.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-bold text-white/50 mb-2">我的链上证书（{indexed.length}）</div>
          <div className="space-y-1.5">
            {indexed.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between text-xs bg-white/[0.06] border border-white/10 rounded-lg px-3 py-2"
              >
                <span className="font-bold text-white/80">证书 #{c.tokenId}</span>
                <span className="font-mono text-white/40">{shortHash(c.reportHash)}</span>
                {c.txHash ? (
                  <a
                    href={explorerTxUrl(c.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-violet-300 hover:text-violet-200 hover:underline"
                  >
                    交易 ↗
                  </a>
                ) : (
                  <span className="text-white/25">—</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CertificateSection;
