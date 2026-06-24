import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SettingsPage } from "../../src/pages/settings.js";
import { useToastStore } from "../../src/stores/toast.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data } as Response;
}

const baseSettings = {
  provider: "anyrouter",
  singleBudgetUsd: 5,
  writeModelId: "gemini-2.5-pro",
  auditModelId: "gemini-2.5-pro",
  masterPrompt: "",
  styleReferences: [],
  customProviders: [],
  providerKeys: {},
  apiKeyMasked: null,
  hasApiKey: false,
};

describe("SettingsPage", () => {
  it("无 key:模型列表 503 → 仍显示供应商推荐模型可选", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/models")) return jsonResponse({ error: "未配置 API Key" }, 503);
      return jsonResponse(baseSettings);
    });
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("api-key-input")).toBeInTheDocument());
    // 模型预览在设置加载完成后才发起,错误提示随后出现
    expect(await screen.findByText(/加载模型列表失败/)).toBeInTheDocument();
    expect(screen.getByTestId("write-model-select").tagName).toBe("SELECT");
    expect(screen.getByTestId("write-model-select")).toHaveValue("gemini-2.5-pro");
  });

  it("有 key:显示打码 + 模型下拉", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/models")) {
        return jsonResponse({ models: [{ id: "gemini-2.5-pro" }, { id: "deepseek-v4-pro" }] });
      }
      return jsonResponse({ ...baseSettings, hasApiKey: true, apiKeyMasked: "sk-22****189f" });
    });
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("api-key-masked")).toHaveTextContent("sk-22****189f"));
    expect(screen.getByTestId("provider-select")).toHaveValue("anyrouter");
    expect(screen.getByTestId("write-model-select").tagName).toBe("SELECT");
    expect(screen.getByTestId("write-model-select")).toHaveValue("gemini-2.5-pro");
  });

  it("保存:PUT 带 apiKey + 模型;成功弹已保存 toast", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).includes("/api/models")) return jsonResponse({ models: [{ id: "gemini-2.5-pro" }, { id: "deepseek-v4-pro" }] });
      if (init?.method === "PUT") return jsonResponse({ ...baseSettings, hasApiKey: true, apiKeyMasked: "sk-ne****key1" });
      return jsonResponse(baseSettings);
    });
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => screen.getByTestId("api-key-input"));
    fireEvent.change(screen.getByTestId("api-key-input"), { target: { value: "sk-newkey111222333" } });
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => {
      const put = calls.find(c => c[1]?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(put![1]!.body as string);
      expect(body.apiKey).toBe("sk-newkey111222333");
      expect(body.provider).toBe("anyrouter");
      expect(body.writeModelId).toBe("gemini-2.5-pro");
    });
    expect(useToastStore.getState().toasts.some(t => t.text.includes("已保存"))).toBe(true);
  });

  it("DeepSeek 作为可选供应商保存", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).includes("/api/models")) return jsonResponse({ models: [{ id: "gemini-2.5-pro" }] });
      if (init?.method === "PUT") return jsonResponse({ ...baseSettings, provider: "deepseek" });
      return jsonResponse(baseSettings);
    });
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => screen.getByTestId("provider-select"));
    fireEvent.change(screen.getByTestId("provider-select"), { target: { value: "deepseek" } });
    expect(screen.getByTestId("write-model-select")).toHaveValue("deepseek-v4-pro");
    expect(screen.getByTestId("audit-model-select")).toHaveValue("deepseek-v4-flash");
    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      const put = calls.find(c => c[1]?.method === "PUT");
      expect(put).toBeTruthy();
      expect(JSON.parse(put![1]!.body as string).provider).toBe("deepseek");
    });
  });

  it("switches the visible key status with the selected provider", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/models")) return jsonResponse({ models: [] }, 503);
      return jsonResponse({
        ...baseSettings,
        hasApiKey: true,
        apiKeyMasked: "sk-ar****1111",
        providerKeys: {
          anyrouter: { hasApiKey: true, apiKeyMasked: "sk-ar****1111" },
          deepseek: { hasApiKey: false, apiKeyMasked: null },
        },
      });
    });

    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("api-key-masked")).toHaveTextContent("sk-ar****1111"));
    fireEvent.change(screen.getByTestId("provider-select"), { target: { value: "deepseek" } });

    await waitFor(() => expect(screen.queryByTestId("api-key-masked")).not.toBeInTheDocument());
    expect(screen.getByTestId("api-key-input")).toHaveValue("");
    await waitFor(() => expect(screen.queryByText(/加载模型列表失败/)).toBeInTheDocument());
  });

  it("can add and save a custom OpenAI-compatible provider", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).includes("/api/models")) return jsonResponse({ models: [] }, 503);
      if (init?.method === "PUT") return jsonResponse({
        ...baseSettings,
        provider: "my-openai",
        writeModelId: "custom-write-model",
        auditModelId: "custom-audit-model",
        customProviders: [{
          id: "my-openai",
          name: "My OpenAI Proxy",
          type: "openai-compatible",
          baseUrl: "https://proxy.example.com/v1",
          auth: "bearer",
          defaultWriteModelId: "custom-write-model",
          defaultAuditModelId: "custom-audit-model",
        }],
      });
      return jsonResponse({ ...baseSettings, customProviders: [] });
    });

    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => screen.getByTestId("custom-provider-add"));
    fireEvent.click(screen.getByTestId("custom-provider-add"));
    expect(screen.getByRole("dialog")).toHaveTextContent("新增供应商");
    fireEvent.change(screen.getByTestId("custom-provider-id-input"), { target: { value: "my-openai" } });
    fireEvent.change(screen.getByTestId("custom-provider-name-input"), { target: { value: "My OpenAI Proxy" } });
    fireEvent.change(screen.getByTestId("custom-provider-base-url-input"), { target: { value: "https://proxy.example.com/v1" } });
    fireEvent.change(screen.getByTestId("custom-provider-format-select"), { target: { value: "openai-compatible" } });
    fireEvent.change(screen.getByTestId("custom-provider-write-model-input"), { target: { value: "custom-write-model" } });
    fireEvent.change(screen.getByTestId("custom-provider-audit-model-input"), { target: { value: "custom-audit-model" } });
    fireEvent.click(screen.getByTestId("custom-provider-dialog-save"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.change(screen.getByTestId("provider-select"), { target: { value: "my-openai" } });
    expect(screen.getByTestId("write-model-select")).toHaveValue("custom-write-model");
    expect(screen.getByTestId("audit-model-select")).toHaveValue("custom-audit-model");
    fireEvent.change(screen.getByTestId("api-key-input"), { target: { value: "sk-custom-provider" } });
    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      const put = calls.find(c => c[1]?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(put![1]!.body as string);
      expect(body.provider).toBe("my-openai");
      expect(body.apiKey).toBe("sk-custom-provider");
      expect(body.writeModelId).toBe("custom-write-model");
      expect(body.auditModelId).toBe("custom-audit-model");
      expect(body.customProviders).toEqual([{
        id: "my-openai",
        name: "My OpenAI Proxy",
        type: "openai-compatible",
        baseUrl: "https://proxy.example.com/v1",
        auth: "bearer",
        defaultWriteModelId: "custom-write-model",
        defaultAuditModelId: "custom-audit-model",
      }]);
    });
  });

  it("keeps a custom provider selected when the provider name is Chinese and the id is blank", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).includes("/api/models")) return jsonResponse({ models: [{ id: "gemini-2.5-pro" }] });
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        return jsonResponse({
          ...baseSettings,
          provider: body.provider,
          customProviders: body.customProviders,
          hasApiKey: true,
          apiKeyMasked: "sk-cu****ider",
        });
      }
      return jsonResponse(baseSettings);
    });

    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => screen.getByTestId("custom-provider-add"));
    fireEvent.click(screen.getByTestId("custom-provider-add"));
    fireEvent.change(screen.getByTestId("custom-provider-name-input"), { target: { value: "熊猫" } });
    fireEvent.change(screen.getByTestId("custom-provider-base-url-input"), { target: { value: "https://api520.pro/v1" } });
    fireEvent.change(screen.getByTestId("custom-provider-auth-select"), { target: { value: "bearer" } });
    fireEvent.change(screen.getByTestId("custom-provider-write-model-input"), { target: { value: "gemini-2.5-pro" } });
    fireEvent.change(screen.getByTestId("custom-provider-audit-model-input"), { target: { value: "gemini-2.5-pro" } });
    fireEvent.click(screen.getByTestId("custom-provider-dialog-save"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.change(screen.getByTestId("api-key-input"), { target: { value: "sk-custom-provider" } });
    fireEvent.click(screen.getByTestId("refresh-models"));

    // 刷新模型只做预览(POST /api/models 携带草稿),绝不触发保存(PUT)
    await waitFor(() => {
      const preview = calls.find(c =>
        String(c[0]).includes("/api/models") &&
        c[1]?.method === "POST" &&
        typeof c[1]?.body === "string" &&
        (JSON.parse(c[1]!.body as string) as { apiKey?: string }).apiKey === "sk-custom-provider");
      expect(preview).toBeTruthy();
      const body = JSON.parse(preview![1]!.body as string);
      expect(body.provider).toMatch(/^custom-/);
      expect(body.customProviders).toEqual([expect.objectContaining({
        id: body.provider,
        name: "熊猫",
        baseUrl: "https://api520.pro/v1",
        auth: "bearer",
      })]);
    });
    // 关键:刷新模型没有偷偷保存设置
    expect(calls.some(c => c[1]?.method === "PUT")).toBe(false);
  });

  it("can type a custom model id even when it is not in the fetched list", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).includes("/api/models")) return jsonResponse({ models: [{ id: "gemini-2.5-pro" }] });
      if (init?.method === "PUT") return jsonResponse(baseSettings);
      return jsonResponse(baseSettings);
    });

    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => screen.getByTestId("write-model-custom"));
    fireEvent.change(screen.getByTestId("write-model-custom"), { target: { value: "custom-router-model" } });
    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      const put = calls.find(c => c[1]?.method === "PUT");
      expect(put).toBeTruthy();
      expect(JSON.parse(put![1]!.body as string).writeModelId).toBe("custom-router-model");
    });
  });

  it("keeps the just-saved provider even if a stale settings read still returns DeepSeek", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).includes("/api/models")) return jsonResponse({ models: [] }, 503);
      if (init?.method === "PUT") return jsonResponse({
        ...baseSettings,
        provider: "anyrouter",
        writeModelId: "gemini-2.5-pro",
        auditModelId: "gemini-2.5-pro",
      });
      return jsonResponse({
        ...baseSettings,
        provider: "deepseek",
        writeModelId: "deepseek-v4-pro",
        auditModelId: "deepseek-v4-flash",
      });
    });

    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("provider-select")).toHaveValue("deepseek"));
    fireEvent.change(screen.getByTestId("provider-select"), { target: { value: "anyrouter" } });
    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      const put = calls.find(c => c[1]?.method === "PUT");
      expect(put).toBeTruthy();
      expect(screen.getByTestId("provider-select")).toHaveValue("anyrouter");
      expect(screen.getByTestId("write-model-select")).toHaveValue("gemini-2.5-pro");
    });
  });

  it("does not drop a style reference just because its name is empty", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).includes("/api/models")) return jsonResponse({ models: [] }, 503);
      if (init?.method === "PUT") return jsonResponse(baseSettings);
      return jsonResponse(baseSettings);
    });

    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => screen.getByTestId("style-reference-add"));
    fireEvent.click(screen.getByTestId("style-reference-add"));
    const contentInput = await screen.findByTestId(/style-reference-content-/);
    fireEvent.change(contentInput, { target: { value: "只填写内容的文风参考" } });
    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      const put = calls.find(c => c[1]?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(put![1]!.body as string);
      expect(body.styleReferences).toHaveLength(1);
      expect(body.styleReferences[0].content).toBe("只填写内容的文风参考");
    });
  });

  it("can add, edit, and delete style references before saving settings", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).includes("/api/models")) return jsonResponse({ models: [] }, 503);
      if (init?.method === "PUT") return jsonResponse(baseSettings);
      return jsonResponse({
        ...baseSettings,
        styleReferences: [
          { id: "style-old", name: "旧文风", content: "旧内容" },
        ],
      });
    });

    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("style-reference-name-style-old")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("style-reference-name-style-old"), { target: { value: "新文风" } });
    fireEvent.change(screen.getByTestId("style-reference-content-style-old"), { target: { value: "新内容" } });
    fireEvent.click(screen.getByTestId("style-reference-add"));
    await waitFor(() => expect(screen.getAllByTestId(/style-reference-name-/).length).toBe(2));
    const addedName = screen.getAllByTestId(/style-reference-name-/).find((el) => (el as HTMLInputElement).value === "");
    expect(addedName).toBeTruthy();
    fireEvent.change(addedName!, { target: { value: "新增文风" } });
    fireEvent.click(screen.getByTestId("style-reference-delete-style-old"));
    fireEvent.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      const put = calls.find(c => c[1]?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(put![1]!.body as string);
      expect(body.styleReferences).toHaveLength(1);
      expect(body.styleReferences[0].name).toBe("新增文风");
    });
  });

  it("调高预算需要二次确认", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/models")) return jsonResponse({ models: [] }, 503);
      return jsonResponse(baseSettings);
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => screen.getByTestId("budget-input"));
    fireEvent.change(screen.getByTestId("budget-input"), { target: { value: "50" } });
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("意外消费"));
    // 拒绝后没有 PUT
    expect(fetchMock.mock.calls.some(c => (c[1] as RequestInit | undefined)?.method === "PUT")).toBe(false);
    confirmSpy.mockRestore();
  });
});
