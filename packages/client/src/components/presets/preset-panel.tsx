import { useCallback, useEffect, useState } from "react";
import { api, type PromptPreset } from "../../api/client.js";

type Drafts = Record<string, { enabled: boolean; content: string }>;
type PresetDrafts = Record<string, {
  enabled: boolean;
  regexScriptsEnabled: boolean;
  generationSettingsJson: string;
  regexScripts: Array<Record<string, unknown>>;
}>;

function regexCount(preset: PromptPreset): number {
  const scripts = preset.extensions?.regex_scripts;
  return Array.isArray(scripts) ? scripts.length : 0;
}

export function PresetPanel(props: { bookId: string }) {
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [presetDrafts, setPresetDrafts] = useState<PresetDrafts>({});
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await api.listPresets(props.bookId);
      setPresets(next);
      setDrafts(Object.fromEntries(next.flatMap((preset) =>
        preset.blocks.map((block) => [
          block.id,
          { enabled: block.enabled, content: block.content },
        ]),
      )));
      setPresetDrafts(Object.fromEntries(next.map((preset) => [
        preset.id,
        {
          enabled: preset.enabled,
          regexScriptsEnabled: preset.regexScriptsEnabled,
          generationSettingsJson: JSON.stringify(preset.generationSettings ?? {}, null, 2),
          regexScripts: Array.isArray(preset.extensions?.regex_scripts)
            ? [...preset.extensions.regex_scripts as Array<Record<string, unknown>>]
            : [],
        },
      ])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.bookId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function saveBlock(presetId: string, blockId: string) {
    const draft = drafts[blockId];
    if (!draft) return;
    await api.updatePromptBlock(props.bookId, presetId, blockId, draft);
    await reload();
  }

  async function savePreset(presetId: string) {
    const draft = presetDrafts[presetId];
    if (!draft) return;
    let generationSettings: Record<string, unknown>;
    try {
      const parsed = JSON.parse(draft.generationSettingsJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("生成参数必须是 JSON 对象");
      }
      generationSettings = parsed as Record<string, unknown>;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    await api.updatePreset(props.bookId, presetId, {
      enabled: draft.enabled,
      regexScriptsEnabled: draft.regexScriptsEnabled,
      generationSettings,
      regexScripts: draft.regexScripts,
    });
    await reload();
  }

  function updateRegexScript(
    presetId: string,
    index: number,
    patch: Record<string, unknown>,
  ) {
    const draft = presetDrafts[presetId];
    if (!draft) return;
    const nextScripts = draft.regexScripts.map((script, scriptIndex) =>
      scriptIndex === index ? { ...script, ...patch } : script,
    );
    setPresetDrafts({
      ...presetDrafts,
      [presetId]: { ...draft, regexScripts: nextScripts },
    });
  }

  return (
    <section data-testid="preset-panel">
      {error && <p role="alert" style={{ color: "#c00" }}>{error}</p>}
      <strong>提示词预设</strong>
      {presets.length === 0 && <p style={{ color: "#888" }}>暂无预设</p>}
      {presets.map((preset) => (
        <div key={preset.id} style={{ marginTop: 10 }}>
          <h3 style={{ fontSize: 14, margin: "6px 0" }}>{preset.name}</h3>
          {presetDrafts[preset.id] && (
            <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, marginBottom: 8 }}>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, marginRight: 12 }}>
                <input
                  data-testid={`preset-enabled-${preset.id}`}
                  type="checkbox"
                  checked={presetDrafts[preset.id]!.enabled}
                  onChange={(event) =>
                    setPresetDrafts({
                      ...presetDrafts,
                      [preset.id]: {
                        ...presetDrafts[preset.id]!,
                        enabled: event.target.checked,
                      },
                    })
                  }
                />
                启用
              </label>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={presetDrafts[preset.id]!.regexScriptsEnabled}
                  onChange={(event) =>
                    setPresetDrafts({
                      ...presetDrafts,
                      [preset.id]: {
                        ...presetDrafts[preset.id]!,
                        regexScriptsEnabled: event.target.checked,
                      },
                    })
                  }
                />
                正则脚本
              </label>
              <label style={{ display: "block", fontSize: 12, marginTop: 8 }}>
                生成参数
                <textarea
                  data-testid={`preset-generation-settings-${preset.id}`}
                  value={presetDrafts[preset.id]!.generationSettingsJson}
                  rows={3}
                  onChange={(event) =>
                    setPresetDrafts({
                      ...presetDrafts,
                      [preset.id]: {
                        ...presetDrafts[preset.id]!,
                        generationSettingsJson: event.target.value,
                      },
                    })
                  }
                  style={{ width: "100%", resize: "vertical", fontFamily: "monospace" }}
                />
              </label>
              {presetDrafts[preset.id]!.regexScripts.map((script, index) => {
                const scriptId = typeof script.id === "string" ? script.id : String(index);
                return (
                  <div key={scriptId} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 6, alignItems: "center", marginTop: 6 }}>
                    <label style={{ fontSize: 12 }}>
                      <input
                        data-testid={`preset-regex-disabled-${scriptId}`}
                        type="checkbox"
                        checked={script.disabled === true}
                        onChange={(event) =>
                          updateRegexScript(preset.id, index, { disabled: event.target.checked })
                        }
                      />
                      禁用
                    </label>
                    <input
                      data-testid={`preset-regex-replace-${scriptId}`}
                      value={typeof script.replaceString === "string" ? script.replaceString : ""}
                      onChange={(event) =>
                        updateRegexScript(preset.id, index, { replaceString: event.target.value })
                      }
                      style={{ width: "100%" }}
                    />
                  </div>
                );
              })}
              <button
                data-testid={`preset-save-${preset.id}`}
                onClick={() => void savePreset(preset.id)}
                style={{ marginTop: 8 }}
              >
                保存预设
              </button>
            </div>
          )}
          <p style={{ color: "#666", fontSize: 12, margin: "0 0 8px" }}>
            {preset.enabled ? "已启用" : "已停用"} / 正则 {regexCount(preset)}
          </p>
          {preset.blocks
            .slice()
            .sort((a, b) => (a.stackIndex ?? 999_999) - (b.stackIndex ?? 999_999))
            .map((block) => {
              const draft = drafts[block.id] ?? {
                enabled: block.enabled,
                content: block.content,
              };
              return (
                <article
                  key={block.id}
                  style={{ border: "1px solid #e5e5e5", borderRadius: 6, padding: 8, marginBottom: 8 }}
                >
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      data-testid={`preset-block-toggle-${block.id}`}
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          [block.id]: { ...draft, enabled: event.target.checked },
                        })
                      }
                    />
                    <strong>{block.name}</strong>
                  </label>
                  <p style={{ color: "#666", fontSize: 12, margin: "4px 0" }}>
                    {block.role} / {block.sourceIdentifier} / stack {block.stackIndex ?? "-"}
                    {block.sourcePromptEnabled !== block.sourceOrderEnabled
                      ? " / 提示词顺序不一致"
                      : ""}
                  </p>
                  <textarea
                    data-testid={`preset-block-content-${block.id}`}
                    value={draft.content}
                    rows={4}
                    onChange={(event) =>
                      setDrafts({
                        ...drafts,
                        [block.id]: { ...draft, content: event.target.value },
                      })
                    }
                    style={{ width: "100%", resize: "vertical" }}
                  />
                  <button
                    data-testid={`preset-block-save-${block.id}`}
                    onClick={() => void saveBlock(preset.id, block.id)}
                    style={{ marginTop: 6 }}
                  >
                    保存
                  </button>
                </article>
              );
            })}
        </div>
      ))}
    </section>
  );
}
