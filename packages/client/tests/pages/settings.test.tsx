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
  singleBudgetUsd: 5,
  writeModelId: "deepseek-v4-pro",
  auditModelId: "deepseek-v4-flash",
  apiKeyMasked: null,
  hasApiKey: false,
};

describe("SettingsPage", () => {
  it("无 key:模型列表 503 → 显示手动输入兜底", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/models")) return jsonResponse({ error: "未配置 API Key" }, 503);
      return jsonResponse(baseSettings);
    });
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("api-key-input")).toBeInTheDocument());
    expect(screen.getByText(/加载模型列表失败/)).toBeInTheDocument();
    // 手动输入兜底是 input 不是 select
    expect(screen.getByTestId("write-model-select").tagName).toBe("INPUT");
  });

  it("有 key:显示打码 + 模型下拉", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/models")) {
        return jsonResponse({ models: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }] });
      }
      return jsonResponse({ ...baseSettings, hasApiKey: true, apiKeyMasked: "sk-22****189f" });
    });
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("api-key-masked")).toHaveTextContent("sk-22****189f"));
    expect(screen.getByTestId("write-model-select").tagName).toBe("SELECT");
    expect(screen.getByTestId("write-model-select")).toHaveValue("deepseek-v4-pro");
  });

  it("保存:PUT 带 apiKey + 模型;成功弹已保存 toast", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).includes("/api/models")) return jsonResponse({ models: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }] });
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
      expect(body.writeModelId).toBe("deepseek-v4-pro");
    });
    expect(useToastStore.getState().toasts.some(t => t.text.includes("已保存"))).toBe(true);
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
