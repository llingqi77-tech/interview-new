import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getSettings,
  saveSettings,
  testLlm,
  type LlmProbeResult,
  type SettingsEntry,
  type SettingsField,
  type SettingsSnapshot,
} from '../src/settings';

/**
 * 服务端密钥配置弹窗
 *
 * 只负责「填 → 存 → 看状态」。密钥永不回显明文：
 * 已配置的项只显示掩码（如 sk-a••••••9f2c），输入框留空表示"不改"。
 * 保存后服务端立即把值写进 process.env，无需重启 dev server。
 */

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const TOKEN_STORAGE_KEY = 'lgd.settings.token';

function readStoredToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // 隐私模式下 sessionStorage 可能不可用，忽略
  }
}

function sourceLabel(entry: SettingsEntry | undefined): string {
  if (!entry || !entry.configured) return '未配置';
  return entry.source === 'runtime' ? '已配置 · 页面' : '已配置 · 环境变量';
}

const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string>('llm');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [token, setToken] = useState<string>(() => readStoredToken());
  const [tokenInput, setTokenInput] = useState('');
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<LlmProbeResult | null>(null);

  const load = useCallback(
    async (withToken?: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await getSettings(withToken ?? token);
        if (!data) {
          setError('设置接口无响应（/api/settings）');
          return;
        }
        setSnapshot(data);
        if (data.groups.length > 0 && !data.groups.some((group) => group.id === activeGroupId)) {
          setActiveGroupId(data.groups[0].id);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    // activeGroupId 只用于兜底切换，不参与请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token]
  );

  useEffect(() => {
    if (!open) return;
    setDrafts({});
    setNotice(null);
    setProbe(null);
    void load();
  }, [open, load]);

  const activeGroup = useMemo(
    () => snapshot?.groups.find((group) => group.id === activeGroupId) ?? snapshot?.groups[0] ?? null,
    [snapshot, activeGroupId]
  );

  const dirtyKeys = useMemo(() => Object.keys(drafts), [drafts]);

  if (!open) return null;

  const setDraft = (key: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
    setNotice(null);
  };

  const clearDraft = (key: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSave = async () => {
    if (dirtyKeys.length === 0) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveSettings(drafts, token);
      setSnapshot((prev) => (prev ? { ...prev, entries: result.entries } : prev));
      setDrafts({});
      setNotice(
        result.changed.length > 0
          ? `已保存 ${result.changed.length} 项：${result.changed.join('、')}`
          : '没有变化'
      );
      // 刚设置了设置页令牌：立刻用它，否则下一次请求会被 403
      const newToken = drafts.SETTINGS_ADMIN_TOKEN;
      if (newToken) {
        setToken(newToken);
        storeToken(newToken);
        setTokenInput('');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleTokenSubmit = async () => {
    const value = tokenInput.trim();
    if (!value) return;
    setToken(value);
    storeToken(value);
    setTokenInput('');
    await load(value);
  };

  const handleProbe = async () => {
    setProbing(true);
    setProbe(null);
    try {
      setProbe(await testLlm(token));
    } catch (err: unknown) {
      setProbe({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setProbing(false);
    }
  };

  const renderField = (field: SettingsField) => {
    const entry = snapshot?.entries[field.key];
    const dirty = Object.prototype.hasOwnProperty.call(drafts, field.key);
    const value = drafts[field.key] ?? '';
    const configured = entry?.configured ?? false;

    return (
      <div key={field.key} className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs text-white/75 flex items-center gap-2 min-w-0">
            <span className="truncate">{field.label}</span>
            <code className="text-[10px] text-white/30 truncate">{field.key}</code>
          </label>
          <span
            className={`glass-chip text-[10px] px-2 py-0.5 shrink-0 ${
              configured ? 'badge-success' : 'badge-warning'
            }`}
          >
            {sourceLabel(entry)}
          </span>
        </div>

        {field.hint && <p className="text-[11px] text-white/40 leading-snug">{field.hint}</p>}

        <div className="flex items-center gap-2">
          <input
            className="glass-input flex-1 px-3 py-2 text-sm font-mono"
            type={field.secret ? 'password' : 'text'}
            value={value}
            onChange={(event) => setDraft(field.key, event.target.value)}
            placeholder={entry?.preview ?? field.placeholder ?? '未配置'}
            autoComplete="off"
            spellCheck={false}
          />
          {dirty ? (
            <button
              type="button"
              onClick={() => clearDraft(field.key)}
              className="glass-btn-ghost text-[11px] px-2 py-1 shrink-0"
              title="撤销这次修改"
            >
              撤销
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setDraft(field.key, '')}
              className="glass-btn-ghost text-[11px] px-2 py-1 shrink-0"
              title="清除页面配置，回落到 .env.local"
              disabled={!configured || entry?.source !== 'runtime'}
            >
              清除
            </button>
          )}
        </div>

        {dirty && (
          <p className="text-[11px] text-brand/80">
            {value === '' ? '将清除页面配置，回落到环境变量' : '待保存'}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="glass-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="glass-modal p-5 md:p-6 max-w-3xl w-full mx-4 max-h-[88vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="服务端配置"
      >
        <div className="flex items-start justify-between mb-3 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white">服务端配置</h2>
            <p className="text-xs text-white/50 mt-1">
              <span title={snapshot?.configFile ?? undefined}>
                填完即生效，写入 {(snapshot?.configFile ?? '.runtime-config.json').split(/[\\/]/).pop()}，无需重启
              </span>
            </p>
          </div>
          <button onClick={onClose} className="glass-btn-ghost text-sm px-2 py-1" aria-label="关闭">
            ✕
          </button>
        </div>

        {snapshot && !snapshot.writable && (
          <div className="glass-chip badge-warning text-xs px-3 py-2 mb-3 block shrink-0">
            {snapshot.reason ?? '当前环境不可写'}
          </div>
        )}

        {snapshot && snapshot.tokenRequired && !snapshot.authorized && (
          <div className="glass-chip badge-warning text-xs px-3 py-2 mb-3 block shrink-0 space-y-2">
            <div>{snapshot.authReason ?? '需要设置页令牌'}</div>
            <div className="flex items-center gap-2">
              <input
                className="glass-input flex-1 px-3 py-1.5 text-xs font-mono"
                type="password"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="SETTINGS_ADMIN_TOKEN"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={handleTokenSubmit}
                className="glass-btn text-[11px] px-2 py-1 shrink-0"
              >
                验证
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="glass-chip badge-danger text-xs px-3 py-2 mb-3 block shrink-0">{error}</div>
        )}
        {notice && (
          <div className="glass-chip badge-success text-xs px-3 py-2 mb-3 block shrink-0">{notice}</div>
        )}

        {loading && !snapshot && <p className="text-sm text-white/60 py-10 text-center">加载中…</p>}

        {snapshot && (
          <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-4">
            <div className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible shrink-0 md:w-36 scrollbar-hide">
              {snapshot.groups.map((group) => {
                const active = group.id === activeGroup?.id;
                const missing = group.fields.filter(
                  (field) => field.secret && !snapshot.entries[field.key]?.configured
                ).length;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setActiveGroupId(group.id)}
                    className={`text-left text-xs px-3 py-2 rounded-xl whitespace-nowrap transition-colors ${
                      active ? 'glass-selected text-white' : 'text-white/60 hover:text-white/85'
                    }`}
                  >
                    {group.title}
                    {missing > 0 && <span className="ml-1 text-[10px] text-amber-300/80">·{missing}</span>}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto glass-scroll pr-1 space-y-4">
              {activeGroup && (
                <>
                  <p className="text-[11px] text-white/45 leading-relaxed">{activeGroup.description}</p>
                  {activeGroup.fields.map(renderField)}

                  {activeGroup.id === 'llm' && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={handleProbe}
                        disabled={probing}
                        className="glass-btn text-xs px-3 py-1.5 disabled:opacity-50"
                      >
                        {probing ? '探测中…' : '测试 LLM 连接'}
                      </button>
                      {probe && (
                        <div
                          className={`mt-2 text-[11px] px-3 py-2 rounded-xl ${
                            probe.ok ? 'badge-success' : 'badge-danger'
                          }`}
                        >
                          {probe.ok ? (
                            <>
                              连通 · {probe.latencyMs}ms · {probe.baseUrl}
                              {probe.modelAvailable === false && (
                                <span className="block text-amber-300/90 mt-1">
                                  端点可达，但模型 {probe.model} 不在返回列表里
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              {probe.error ?? '探测失败'}
                              {probe.status ? `（HTTP ${probe.status}）` : ''}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-white/10 shrink-0">
          <span className="text-[11px] text-white/40">
            {dirtyKeys.length > 0 ? `${dirtyKeys.length} 项待保存` : '密钥只存服务端，前端不持有'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrafts({})}
              disabled={dirtyKeys.length === 0 || saving}
              className="glass-btn-ghost text-sm px-3 py-1.5 disabled:opacity-40"
            >
              重置
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={dirtyKeys.length === 0 || saving || !snapshot?.writable}
              className="glass-btn-primary text-sm px-4 py-1.5 disabled:opacity-40"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
