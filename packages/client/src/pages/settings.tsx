import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../i18n/zh-CN.js";
import { useToastStore } from "../stores/toast.js";

interface SettingsData {
  singleBudgetUsd: number;
  writeModelId: string;
  auditModelId: string;
  masterPrompt: string;
  apiKeyMasked: string | null;
  hasApiKey: boolean;
}

interface ModelOption { id: string }

export function SettingsPage() {
  const navigate = useNavigate();
  const pushToast = useToastStore(s => s.push);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [writeModelId, setWriteModelId] = useState("");
  const [auditModelId, setAuditModelId] = useState("");
  const [budget, setBudget] = useState("");
  const [masterPrompt, setMasterPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/settings");
    if (!res.ok) return;
    const j = await res.json() as SettingsData;
    setSettings(j);
    setWriteModelId(j.writeModelId);
    setAuditModelId(j.auditModelId);
    setBudget(String(j.singleBudgetUsd));
    setMasterPrompt(j.masterPrompt ?? "");
  }, []);

  const refreshModels = useCallback(async () => {
    setModelsError(null);
    setModelsLoading(true);
    try {
      const res = await fetch("/api/models");
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json() as { models: ModelOption[] };
      setModels(j.models);
    } catch (e) {
      setModelsError(t.settings.modelLoadFailed);
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    void refreshModels();
  }, [reload, refreshModels]);

  const save = async () => {
    const budgetNum = Number(budget);
    if (settings && budgetNum > settings.singleBudgetUsd) {
      const ok = window.confirm("调高预算上限可能产生意外消费,确认?");
      if (!ok) return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        writeModelId,
        auditModelId,
        masterPrompt,
        ...(budgetNum > 0 ? { singleBudgetUsd: budgetNum } : {}),
      };
      if (apiKeyInput.trim()) body.apiKey = apiKeyInput.trim();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setApiKeyInput("");
      await reload();
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
  ) => (
    <span style={{ display: "flex", gap: 6 }}>
      {models.length > 0 ? (
        // spec §5.3:用户聚焦下拉(准备选模型)时实时重新拉取列表
        <select
          data-testid={testId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => void refreshModels()}
          style={{ flex: 1, padding: 6 }}
        >
          {!models.some(m => m.id === value) && value && <option value={value}>{value}(手动)</option>}
          {models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
        </select>
      ) : (
        <input
          data-testid={testId}
          value={value}
          placeholder={t.settings.customModelId}
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1, padding: 6 }}
        />
      )}
    </span>
  );

  return (
    <main data-testid="page-settings" style={{ padding: "32px 24px", maxWidth: 640, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button className="ios-btn-small" onClick={() => navigate(-1)}>‹ {t.common.back}</button>
        <h1 className="large-title" style={{ fontSize: 28 }}>{t.settings.title}</h1>
      </header>

      <p className="settings-caption" style={{ paddingLeft: 4 }}>{t.settings.apiKey}(DeepSeek)</p>
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
        Key 只保存在本机 secrets.env,不会上传到任何第三方。
      </p>

      <p className="settings-caption" style={{ paddingLeft: 4, display: "flex", alignItems: "center", gap: 8 }}>
        {t.settings.model}
        <button className="ios-btn-small" data-testid="refresh-models" onClick={() => void refreshModels()} disabled={modelsLoading}>
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
    </main>
  );
}
