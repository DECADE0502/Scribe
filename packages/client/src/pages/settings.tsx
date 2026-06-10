import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../i18n/zh-CN.js";
import { useToastStore } from "../stores/toast.js";

interface SettingsData {
  singleBudgetUsd: number;
  writeModelId: string;
  auditModelId: string;
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
  const [writeModelId, setWriteModelId] = useState("");
  const [auditModelId, setAuditModelId] = useState("");
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/settings");
    if (!res.ok) return;
    const j = await res.json() as SettingsData;
    setSettings(j);
    setWriteModelId(j.writeModelId);
    setAuditModelId(j.auditModelId);
    setBudget(String(j.singleBudgetUsd));
  }, []);

  const refreshModels = useCallback(async () => {
    setModelsError(null);
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
        <select data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, padding: 6 }}>
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
    <main data-testid="page-settings" style={{ padding: 24, maxWidth: 640, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate(-1)}>{t.common.back}</button>
        <h1 style={{ margin: 0, fontSize: 20 }}>{t.settings.title}</h1>
      </header>

      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15 }}>{t.settings.apiKey}(DeepSeek)</h2>
        {settings?.hasApiKey && (
          <p data-testid="api-key-masked" style={{ fontSize: 13, color: "#666" }}>
            当前:{settings.apiKeyMasked}
          </p>
        )}
        <input
          data-testid="api-key-input"
          type="password"
          placeholder={settings?.hasApiKey ? "输入新 Key 以替换(留空保持不变)" : "sk-..."}
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          style={{ width: "100%", padding: 8 }}
        />
        <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0" }}>
          Key 只保存在本机 secrets.env,不会上传到任何第三方。
        </p>
      </section>

      <section style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>{t.settings.model}</h2>
          <button data-testid="refresh-models" style={{ fontSize: 12 }} onClick={() => void refreshModels()}>
            {t.settings.refreshModels}
          </button>
        </div>
        {modelsError && <p role="alert" style={{ color: "#c60", fontSize: 13 }}>{modelsError}</p>}
        <label style={{ display: "block", fontSize: 13, margin: "8px 0 2px", color: "#666" }}>写作模型</label>
        {modelSelect(writeModelId, setWriteModelId, "write-model-select")}
        <label style={{ display: "block", fontSize: 13, margin: "8px 0 2px", color: "#666" }}>审查模型</label>
        {modelSelect(auditModelId, setAuditModelId, "audit-model-select")}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 15 }}>单次预算上限(USD)</h2>
        <input
          data-testid="budget-input"
          type="number"
          min="0.1"
          step="0.5"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          style={{ width: 120, padding: 6 }}
        />
        <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0" }}>
          自动写作(/auto N)启动前会按此上限做预算预检。
        </p>
      </section>

      <button data-testid="settings-save" onClick={() => void save()} disabled={saving}>
        {saving ? t.app.loading : t.common.save}
      </button>
    </main>
  );
}
