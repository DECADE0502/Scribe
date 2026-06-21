import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../i18n/zh-CN.js";
import { useToastStore } from "../stores/toast.js";

interface SettingsData {
  provider: ProviderId;
  singleBudgetUsd: number;
  writeModelId: string;
  auditModelId: string;
  masterPrompt: string;
  styleReferences: StyleReference[];
  customProviders: CustomProviderConfig[];
  providerKeys?: Record<string, ProviderKeyStatus>;
  apiKeyMasked: string | null;
  hasApiKey: boolean;
}

type ProviderId = string;
interface ModelOption { id: string }
interface StyleReference { id: string; name: string; content: string }
interface ProviderKeyStatus { hasApiKey: boolean; apiKeyMasked: string | null }
interface CustomProviderConfig {
  id: string;
  name: string;
  type: "openai-compatible";
  baseUrl: string;
  auth: "bearer" | "api-key";
  defaultWriteModelId: string;
  defaultAuditModelId: string;
}
interface CustomProviderDraft extends CustomProviderConfig { localId: string }

const BUILTIN_PROVIDER_LABELS: Record<string, string> = {
  anyrouter: "AnyRouter",
  deepseek: "DeepSeek",
  mimo: "MiMo",
};

const PROVIDER_RECOMMENDED_MODELS: Record<string, string[]> = {
  anyrouter: ["gemini-2.5-pro", "gpt-5-codex", "claude-opus-4.5", "deepseek-v4-pro"],
  deepseek: ["deepseek-v4-pro", "deepseek-v4-flash"],
  mimo: ["mimo-v2.5-pro"],
};

const PROVIDER_DEFAULT_MODELS: Record<string, { write: string; audit: string }> = {
  anyrouter: { write: "gemini-2.5-pro", audit: "gemini-2.5-pro" },
  deepseek: { write: "deepseek-v4-pro", audit: "deepseek-v4-flash" },
  mimo: { write: "mimo-v2.5-pro", audit: "mimo-v2.5-pro" },
};

function normalizeProvider(value: unknown): ProviderId {
  return typeof value === "string" && value ? value : "anyrouter";
}

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function makeStableCustomProviderId(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `custom-${(hash >>> 0).toString(36)}`;
}

function customToDraft(provider: CustomProviderConfig): CustomProviderDraft {
  return { ...provider, localId: provider.id };
}

function draftToConfig(provider: CustomProviderDraft): CustomProviderConfig | null {
  const name = provider.name.trim();
  const baseUrl = provider.baseUrl.trim();
  const id = normalizeProviderId(provider.id) || makeStableCustomProviderId(`${name}|${baseUrl}`);
  if (!id || !baseUrl) return null;
  return {
    id,
    name: name || id,
    type: "openai-compatible",
    baseUrl,
    auth: provider.auth,
    defaultWriteModelId: provider.defaultWriteModelId.trim(),
    defaultAuditModelId: provider.defaultAuditModelId.trim(),
  };
}

function providerLabel(providerId: string, customProviders: CustomProviderDraft[]): string {
  return BUILTIN_PROVIDER_LABELS[providerId] ??
    customProviders.find(item => item.id === providerId)?.name.trim() ??
    providerId;
}

function keyStatusFor(settings: SettingsData | null, providerId: string): ProviderKeyStatus {
  return settings?.providerKeys?.[providerId] ?? { hasApiKey: false, apiKeyMasked: null };
}

function makeStyleReferenceId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `style-${crypto.randomUUID()}`;
  }
  return `style-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeCustomProviderDraft(): CustomProviderDraft {
  return {
    localId: "new",
    id: "",
    name: "",
    type: "openai-compatible",
    baseUrl: "",
    auth: "bearer",
    defaultWriteModelId: "",
    defaultAuditModelId: "",
  };
}

export function SettingsPage() {
  const navigate = useNavigate();
  const pushToast = useToastStore(s => s.push);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [provider, setProvider] = useState<ProviderId>("anyrouter");
  const [writeModelId, setWriteModelId] = useState("");
  const [auditModelId, setAuditModelId] = useState("");
  const [budget, setBudget] = useState("");
  const [masterPrompt, setMasterPrompt] = useState("");
  const [styleReferences, setStyleReferences] = useState<StyleReference[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomProviderDraft[]>([]);
  const [providerDialog, setProviderDialog] = useState<CustomProviderDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const handleProviderChange = (nextProvider: ProviderId) => {
    const custom = customProviders.find(item => item.id === nextProvider);
    const defaults = custom
      ? { write: custom.defaultWriteModelId, audit: custom.defaultAuditModelId }
      : PROVIDER_DEFAULT_MODELS[nextProvider];
    setProvider(nextProvider);
    setApiKeyInput("");
    setSettings(current => current
      ? {
        ...current,
        provider: nextProvider,
        ...keyStatusFor(current, nextProvider),
      }
      : current);
    setModels([]);
    setModelsError(null);
    if (defaults?.write) setWriteModelId(defaults.write);
    if (defaults?.audit) setAuditModelId(defaults.audit);
  };

  const saveProviderDialog = () => {
    if (!providerDialog) return;
    const config = draftToConfig(providerDialog);
    if (!config) return;
    const draft = customToDraft(config);
    setCustomProviders(items => {
      const exists = items.some(item => item.localId === providerDialog.localId || item.id === config.id);
      return exists
        ? items.map(item => item.localId === providerDialog.localId || item.id === config.id ? draft : item)
        : [...items, draft];
    });
    setProvider(config.id);
    setModels([]);
    setModelsError(null);
    if (config.defaultWriteModelId) setWriteModelId(config.defaultWriteModelId);
    if (config.defaultAuditModelId) setAuditModelId(config.defaultAuditModelId);
    setProviderDialog(null);
  };

  const reload = useCallback(async () => {
    const res = await fetch("/api/settings");
    if (!res.ok) return;
    const j = await res.json() as SettingsData;
    setSettings(j);
    setProvider(normalizeProvider(j.provider));
    setWriteModelId(j.writeModelId);
    setAuditModelId(j.auditModelId);
    setBudget(String(j.singleBudgetUsd));
    setMasterPrompt(j.masterPrompt ?? "");
    setStyleReferences(Array.isArray(j.styleReferences) ? j.styleReferences : []);
    setCustomProviders(Array.isArray(j.customProviders) ? j.customProviders.map(customToDraft) : []);
  }, []);

  const refreshModels = useCallback(async (syncCurrentSettings = false) => {
    setModelsError(null);
    setModelsLoading(true);
    try {
      if (syncCurrentSettings) {
        const budgetNum = Number(budget);
        const savedStyleReferences = styleReferences
          .map(ref => ({ ...ref, name: ref.name.trim() }))
          .filter(ref => ref.id);
        const savedCustomProviders = customProviders
          .map(draftToConfig)
          .filter((item): item is CustomProviderConfig => !!item);
        const body: Record<string, unknown> = {
          provider,
          writeModelId,
          auditModelId,
          masterPrompt,
          styleReferences: savedStyleReferences,
          customProviders: savedCustomProviders,
          ...(budgetNum > 0 ? { singleBudgetUsd: budgetNum } : {}),
        };
        if (apiKeyInput.trim()) body.apiKey = apiKeyInput.trim();
        const settingsRes = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!settingsRes.ok) throw new Error(`HTTP ${settingsRes.status}`);
        const updated = await settingsRes.json().catch(() => null) as Partial<SettingsData> | null;
        if (updated) {
          setSettings(current => ({
            provider,
            writeModelId,
            auditModelId,
            masterPrompt,
            styleReferences: savedStyleReferences,
            customProviders: savedCustomProviders,
            providerKeys: updated.providerKeys ?? current?.providerKeys ?? {},
            singleBudgetUsd: budgetNum > 0 ? budgetNum : current?.singleBudgetUsd ?? 5,
            apiKeyMasked: updated.apiKeyMasked ?? keyStatusFor(current, provider).apiKeyMasked,
            hasApiKey: updated.hasApiKey ?? keyStatusFor(current, provider).hasApiKey,
          }));
        }
      }
      const res = await fetch("/api/models");
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json() as { models: ModelOption[] };
      setModels(j.models);
    } catch (e) {
      setModelsError(`${t.settings.modelLoadFailed}: ${e instanceof Error ? e.message : String(e)}`);
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [apiKeyInput, auditModelId, budget, customProviders, masterPrompt, provider, styleReferences, writeModelId]);

  useEffect(() => {
    void reload();
    void refreshModels(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const budgetNum = Number(budget);
    if (settings && budgetNum > settings.singleBudgetUsd) {
      const ok = window.confirm("调高预算上限可能产生意外消费,确认?");
      if (!ok) return;
    }
    setSaving(true);
    try {
      const savedStyleReferences = styleReferences
        .map(ref => ({ ...ref, name: ref.name.trim() }))
        .filter(ref => ref.id);
      const savedCustomProviders = customProviders
        .map(draftToConfig)
        .filter((item): item is CustomProviderConfig => !!item);
      const body: Record<string, unknown> = {
        provider,
        writeModelId,
        auditModelId,
        masterPrompt,
        styleReferences: savedStyleReferences,
        customProviders: savedCustomProviders,
        ...(budgetNum > 0 ? { singleBudgetUsd: budgetNum } : {}),
      };
      if (apiKeyInput.trim()) body.apiKey = apiKeyInput.trim();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json().catch(() => ({})) as Partial<SettingsData>;
      setApiKeyInput("");
      setSettings({
        provider,
        writeModelId,
        auditModelId,
        masterPrompt,
        styleReferences: savedStyleReferences,
        customProviders: savedCustomProviders,
        providerKeys: j.providerKeys ?? settings?.providerKeys ?? {},
        singleBudgetUsd: budgetNum > 0 ? budgetNum : settings?.singleBudgetUsd ?? 5,
        apiKeyMasked: j.apiKeyMasked ?? settings?.apiKeyMasked ?? null,
        hasApiKey: j.hasApiKey ?? settings?.hasApiKey ?? !!apiKeyInput.trim(),
      });
      setProvider(provider);
      setWriteModelId(writeModelId);
      setAuditModelId(auditModelId);
      setBudget(String(budgetNum > 0 ? budgetNum : settings?.singleBudgetUsd ?? 5));
      setMasterPrompt(masterPrompt);
      setStyleReferences(Array.isArray(j.styleReferences) ? j.styleReferences : savedStyleReferences);
      setCustomProviders(Array.isArray(j.customProviders) ? j.customProviders.map(customToDraft) : savedCustomProviders.map(customToDraft));
      // key 变了之后重拉模型列表
      void refreshModels();
      pushToast({ level: "info", text: t.settings.savedTip });
    } catch (e) {
      pushToast({ level: "error", text: `${t.errors.saveFailed}:${e instanceof Error ? e.message : e}` });
    } finally {
      setSaving(false);
    }
  };

  const modelSelect = (
    value: string,
    onChange: (v: string) => void,
    testId: string,
  ) => {
    const custom = customProviders.find(item => item.id === provider);
    const recommended = custom
      ? [custom.defaultWriteModelId, custom.defaultAuditModelId]
      : PROVIDER_RECOMMENDED_MODELS[provider] ?? [];
    const modelIds = [
      ...recommended,
      ...models.map((model) => model.id),
      ...(value ? [value] : []),
    ];
    const options = Array.from(new Set(modelIds.filter(Boolean)));
    return (
      <span style={{ display: "grid", gap: 6 }}>
        <select
          data-testid={testId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => void refreshModels(true)}
          style={{ flex: 1, padding: 6 }}
        >
          {options.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
        <input
          data-testid={testId.replace("-select", "-custom")}
          value={value}
          placeholder="也可以直接输入模型 ID"
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1, padding: 6, fontSize: 12 }}
        />
      </span>
    );
  };

  return (
    <main data-testid="page-settings" style={{ padding: "32px 24px", maxWidth: 640, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button className="ios-btn-small" onClick={() => navigate(-1)}>‹ {t.common.back}</button>
        <h1 className="large-title" style={{ fontSize: 28 }}>{t.settings.title}</h1>
      </header>

      <p className="settings-caption" style={{ paddingLeft: 4 }}>供应商</p>
      <div className="settings-group fade-up">
        <div className="settings-row">
          <span className="settings-label">模型供应商</span>
          <select
            data-testid="provider-select"
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
            style={{ flex: 1, maxWidth: 280 }}
          >
            <option value="anyrouter">AnyRouter（默认）</option>
            <option value="deepseek">DeepSeek</option>
            <option value="mimo">MiMo</option>
            {customProviders.map(item => {
              const id = normalizeProviderId(item.id);
              if (!id) return null;
              return <option key={item.localId} value={id}>{item.name.trim() || id}</option>;
            })}
          </select>
        </div>
      </div>

      <p className="settings-caption" style={{ paddingLeft: 4 }}>自定义供应商</p>
      <div className="settings-group fade-up">
        <div style={{ padding: "10px 12px", display: "grid", gap: 10 }}>
          {customProviders.map((item) => (
            <div key={`summary-${item.localId}`} data-testid={`custom-provider-summary-${item.localId}`} style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 10, borderBottom: "1px solid #eee" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{item.name || item.id}</div>
                <div style={{ fontSize: 12, color: "#777", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.id} · OpenAI 兼容 · {item.baseUrl}
                </div>
              </div>
              <button
                className="ios-btn-small"
                data-testid={`custom-provider-edit-${item.localId}`}
                onClick={() => setProviderDialog(item)}
              >
                编辑
              </button>
              <button
                className="ios-btn-small"
                data-testid={`custom-provider-delete-${item.localId}`}
                onClick={() => {
                  setCustomProviders(items => items.filter(providerItem => providerItem.localId !== item.localId));
                  if (provider === item.id) handleProviderChange("anyrouter");
                }}
              >
                删除
              </button>
            </div>
          ))}
          {false && customProviders.map((item) => (
            <div key={item.localId} data-testid={`custom-provider-${item.localId}`} style={{ display: "grid", gap: 8, paddingBottom: 10, borderBottom: "1px solid #eee" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input
                  data-testid={`custom-provider-id-${item.localId}`}
                  value={item.id}
                  placeholder="供应商 ID，如 my-openai"
                  onChange={(e) => setCustomProviders(items => items.map(providerItem =>
                    providerItem.localId === item.localId ? { ...providerItem, id: normalizeProviderId(e.target.value) } : providerItem
                  ))}
                  style={{ padding: 7 }}
                />
                <input
                  data-testid={`custom-provider-name-${item.localId}`}
                  value={item.name}
                  placeholder="显示名称"
                  onChange={(e) => setCustomProviders(items => items.map(providerItem =>
                    providerItem.localId === item.localId ? { ...providerItem, name: e.target.value } : providerItem
                  ))}
                  style={{ padding: 7 }}
                />
              </div>
              <input
                data-testid={`custom-provider-base-url-${item.localId}`}
                value={item.baseUrl}
                placeholder="Base URL，如 https://api.example.com/v1"
                onChange={(e) => setCustomProviders(items => items.map(providerItem =>
                  providerItem.localId === item.localId ? { ...providerItem, baseUrl: e.target.value } : providerItem
                ))}
                style={{ padding: 7 }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px auto", gap: 8, alignItems: "center" }}>
                <input
                  data-testid={`custom-provider-write-model-${item.localId}`}
                  value={item.defaultWriteModelId}
                  placeholder="默认写作模型"
                  onChange={(e) => setCustomProviders(items => items.map(providerItem =>
                    providerItem.localId === item.localId ? { ...providerItem, defaultWriteModelId: e.target.value } : providerItem
                  ))}
                  style={{ padding: 7 }}
                />
                <input
                  data-testid={`custom-provider-audit-model-${item.localId}`}
                  value={item.defaultAuditModelId}
                  placeholder="默认审查模型"
                  onChange={(e) => setCustomProviders(items => items.map(providerItem =>
                    providerItem.localId === item.localId ? { ...providerItem, defaultAuditModelId: e.target.value } : providerItem
                  ))}
                  style={{ padding: 7 }}
                />
                <select
                  data-testid={`custom-provider-auth-${item.localId}`}
                  value={item.auth}
                  onChange={(e) => setCustomProviders(items => items.map(providerItem =>
                    providerItem.localId === item.localId ? { ...providerItem, auth: e.target.value === "api-key" ? "api-key" : "bearer" } : providerItem
                  ))}
                  style={{ padding: 7 }}
                >
                  <option value="bearer">Bearer</option>
                  <option value="api-key">api-key</option>
                </select>
                <button
                  className="ios-btn-small"
                  data-testid={`custom-provider-delete-${item.localId}`}
                  onClick={() => {
                    setCustomProviders(items => items.filter(providerItem => providerItem.localId !== item.localId));
                    if (provider === item.id) handleProviderChange("anyrouter");
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
          {customProviders.length === 0 && <p style={{ color: "#999", fontSize: 13, margin: 0 }}>暂无自定义供应商</p>}
          <button
            className="ios-btn-small"
            data-testid="custom-provider-add"
            onClick={() => setProviderDialog(makeCustomProviderDraft())}
            style={{ justifySelf: "start" }}
          >
            新增供应商
          </button>
        </div>
      </div>
      <p className="settings-caption" style={{ marginTop: -14, marginBottom: 20 }}>
        支持 OpenAI 兼容接口。新增后在上方供应商下拉选择它，并为该供应商单独填写 Key。
      </p>

      <p className="settings-caption" style={{ paddingLeft: 4 }}>{t.settings.apiKey}({providerLabel(provider, customProviders)})</p>
      <div className="settings-group fade-up">
        {settings?.hasApiKey && (
          <div className="settings-row">
            <span className="settings-label muted">当前</span>
            <span data-testid="api-key-masked" style={{ fontFamily: "monospace", fontSize: 13 }}>
              {settings.apiKeyMasked}
            </span>
          </div>
        )}
        <div className="settings-row">
          <input
            data-testid="api-key-input"
            type="password"
            placeholder={settings?.hasApiKey ? "输入新 Key 以替换(留空保持不变)" : "sk-..."}
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            style={{ width: "100%", border: "none", boxShadow: "none", padding: "4px 0" }}
          />
        </div>
      </div>
      <p className="settings-caption" style={{ marginTop: -14, marginBottom: 20 }}>
        Key 只保存在本机 secrets.env,并按供应商分开保存,不会上传到任何第三方。
      </p>

      <p className="settings-caption" style={{ paddingLeft: 4, display: "flex", alignItems: "center", gap: 8 }}>
        {t.settings.model}
        <button className="ios-btn-small" data-testid="refresh-models" onClick={() => void refreshModels(true)} disabled={modelsLoading}>
          {modelsLoading ? t.app.loading : t.settings.refreshModels}
        </button>
      </p>
      {modelsError && (
        <p role="alert" style={{ color: "var(--ios-orange)", fontSize: 13, padding: "0 4px" }}>{modelsError}</p>
      )}
      <div className="settings-group fade-up">
        <div className="settings-row">
          <span className="settings-label">写作模型</span>
          <span style={{ flex: 1, maxWidth: 280 }}>
            {modelSelect(writeModelId, setWriteModelId, "write-model-select")}
          </span>
        </div>
        <div className="settings-row">
          <span className="settings-label">审查模型</span>
          <span style={{ flex: 1, maxWidth: 280 }}>
            {modelSelect(auditModelId, setAuditModelId, "audit-model-select")}
          </span>
        </div>
      </div>

      <p className="settings-caption" style={{ paddingLeft: 4 }}>最深处提示词(全局)</p>
      <div className="settings-group fade-up">
        <div style={{ padding: "10px 12px" }}>
          <textarea
            data-testid="master-prompt-input"
            value={masterPrompt}
            placeholder="写给 AI 的最高优先级指令,会原文拼到所有内置提示词最前端。例:全程第一人称、冷硬克制文风、禁用'仿佛/似乎'、每章结尾留钩子……"
            rows={6}
            onChange={(e) => setMasterPrompt(e.target.value)}
            style={{ width: "100%", resize: "vertical", padding: 8, borderRadius: 8, border: "1px solid #d0d0d0", fontSize: 13, lineHeight: 1.6, fontFamily: "inherit" }}
          />
        </div>
      </div>
      <p className="settings-caption" style={{ marginTop: -14, marginBottom: 20 }}>
        这是全局默认,对所有书生效;单本书可在书内右栏「规则/提示词」覆盖它。留空则不注入。
      </p>

      <p className="settings-caption" style={{ paddingLeft: 4 }}>文风参考</p>
      <div className="settings-group fade-up">
        <div style={{ padding: "10px 12px", display: "grid", gap: 10 }}>
          {styleReferences.map((ref) => (
            <div key={ref.id} data-testid={`style-reference-${ref.id}`} style={{ display: "grid", gap: 6, paddingBottom: 10, borderBottom: "1px solid #eee" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  data-testid={`style-reference-name-${ref.id}`}
                  value={ref.name}
                  placeholder="文风名称"
                  onChange={(e) => setStyleReferences(items =>
                    items.map(item => item.id === ref.id ? { ...item, name: e.target.value } : item)
                  )}
                  style={{ flex: 1, padding: 7 }}
                />
                <button
                  className="ios-btn-small"
                  data-testid={`style-reference-delete-${ref.id}`}
                  onClick={() => setStyleReferences(items => items.filter(item => item.id !== ref.id))}
                >
                  删除
                </button>
              </div>
              <textarea
                data-testid={`style-reference-content-${ref.id}`}
                value={ref.content}
                placeholder="粘贴或整理一段文风要求、样例、禁用表达等。"
                rows={4}
                onChange={(e) => setStyleReferences(items =>
                  items.map(item => item.id === ref.id ? { ...item, content: e.target.value } : item)
                )}
                style={{ width: "100%", resize: "vertical", padding: 8, borderRadius: 8, border: "1px solid #d0d0d0", fontSize: 13, lineHeight: 1.55, fontFamily: "inherit" }}
              />
            </div>
          ))}
          {styleReferences.length === 0 && <p style={{ color: "#999", fontSize: 13, margin: 0 }}>暂无文风参考</p>}
          <button
            className="ios-btn-small"
            data-testid="style-reference-add"
            onClick={() => setStyleReferences(items => [
              ...items,
              { id: makeStyleReferenceId(), name: "", content: "" },
            ])}
            style={{ justifySelf: "start" }}
          >
            新增文风参考
          </button>
        </div>
      </div>
      <p className="settings-caption" style={{ marginTop: -14, marginBottom: 20 }}>
        可配置多组参考;每本书在右栏「规则」里选择其中一组,选择会持续保存。
      </p>

      <p className="settings-caption" style={{ paddingLeft: 4 }}>预算</p>
      <div className="settings-group fade-up">
        <div className="settings-row">
          <span className="settings-label">单次预算上限(USD)</span>
          <input
            data-testid="budget-input"
            type="number"
            min="0.1"
            step="0.5"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            style={{ width: 110, textAlign: "right" }}
          />
        </div>
      </div>
      <p className="settings-caption" style={{ marginTop: -14, marginBottom: 24 }}>
        自动写作(/auto N)启动前会按此上限做预算预检。
      </p>

      <button className="ios-btn-primary" data-testid="settings-save" onClick={() => void save()} disabled={saving} style={{ width: "100%", padding: "11px 0", fontSize: 15 }}>
        {saving ? t.app.loading : t.common.save}
      </button>

      {providerDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="新增供应商"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.28)",
            display: "grid",
            placeItems: "center",
            padding: 20,
            zIndex: 50,
          }}
        >
          <div className="settings-group" style={{ width: "min(560px, 100%)", padding: 16, display: "grid", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>新增供应商</h2>
            <input
              data-testid="custom-provider-id-input"
              value={providerDialog.id}
              placeholder="供应商 ID，如 my-openai"
              onChange={(e) => setProviderDialog(item => item ? { ...item, id: normalizeProviderId(e.target.value) } : item)}
              style={{ padding: 8 }}
            />
            <input
              data-testid="custom-provider-name-input"
              value={providerDialog.name}
              placeholder="供应商名称"
              onChange={(e) => setProviderDialog(item => item ? { ...item, name: e.target.value } : item)}
              style={{ padding: 8 }}
            />
            <input
              data-testid="custom-provider-base-url-input"
              value={providerDialog.baseUrl}
              placeholder="Base URL，如 https://api.example.com/v1"
              onChange={(e) => setProviderDialog(item => item ? { ...item, baseUrl: e.target.value } : item)}
              style={{ padding: 8 }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <select
                data-testid="custom-provider-format-select"
                value={providerDialog.type}
                onChange={(e) => setProviderDialog(item => item ? { ...item, type: e.target.value === "openai-compatible" ? "openai-compatible" : "openai-compatible" } : item)}
                style={{ padding: 8 }}
              >
                <option value="openai-compatible">OpenAI 兼容</option>
              </select>
              <select
                data-testid="custom-provider-auth-select"
                value={providerDialog.auth}
                onChange={(e) => setProviderDialog(item => item ? { ...item, auth: e.target.value === "api-key" ? "api-key" : "bearer" } : item)}
                style={{ padding: 8 }}
              >
                <option value="bearer">Bearer Key</option>
                <option value="api-key">api-key Header</option>
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input
                data-testid="custom-provider-write-model-input"
                value={providerDialog.defaultWriteModelId}
                placeholder="默认写作模型"
                onChange={(e) => setProviderDialog(item => item ? { ...item, defaultWriteModelId: e.target.value } : item)}
                style={{ padding: 8 }}
              />
              <input
                data-testid="custom-provider-audit-model-input"
                value={providerDialog.defaultAuditModelId}
                placeholder="默认审查模型"
                onChange={(e) => setProviderDialog(item => item ? { ...item, defaultAuditModelId: e.target.value } : item)}
                style={{ padding: 8 }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="ios-btn-small" onClick={() => setProviderDialog(null)}>取消</button>
              <button className="ios-btn-primary" data-testid="custom-provider-dialog-save" onClick={saveProviderDialog} style={{ padding: "8px 14px" }}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
