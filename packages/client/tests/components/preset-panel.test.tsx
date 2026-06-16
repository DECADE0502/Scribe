import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PresetPanel } from "../../src/components/presets/preset-panel.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data } as Response;
}

describe("PresetPanel", () => {
  it("lists imported prompt blocks and edits a block", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (init?.method === "PUT") {
        return jsonResponse({ block: { id: "b1", enabled: false } });
      }
      return jsonResponse({
        presets: [{
          id: "p1",
          name: "Izumi",
          enabled: true,
          regexScriptsEnabled: false,
          extensions: { regex_scripts: [{ scriptName: "r" }] },
          blocks: [{
            id: "b1",
            name: "Main",
            sourceIdentifier: "main",
            role: "system",
            enabled: true,
            stackIndex: 0,
            content: "Write well.",
            sourcePromptEnabled: false,
            sourceOrderEnabled: true,
          }],
        }],
      });
    });

    render(<PresetPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByText("Izumi")).toBeInTheDocument());
    expect(screen.getByText("Main")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("preset-block-content-b1"), {
      target: { value: "Write with continuity." },
    });
    fireEvent.click(screen.getByTestId("preset-block-toggle-b1"));
    fireEvent.click(screen.getByTestId("preset-block-save-b1"));

    await waitFor(() => {
      const put = calls.find((call) => call[1]?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(put![1]!.body as string);
      expect(body.enabled).toBe(false);
      expect(body.content).toBe("Write with continuity.");
    });
  });

  it("edits preset settings and regex scripts", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (init?.method === "PUT") {
        return jsonResponse({ preset: { id: "p1" } });
      }
      return jsonResponse({
        presets: [{
          id: "p1",
          name: "Izumi",
          enabled: true,
          regexScriptsEnabled: true,
          generationSettings: { temperature: 0.7 },
          extensions: {
            regex_scripts: [{
              id: "r1",
              scriptName: "replace bad",
              findRegex: "/bad/g",
              replaceString: "good",
              disabled: false,
              promptOnly: true,
            }],
          },
          blocks: [],
        }],
      });
    });

    render(<PresetPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByText("Izumi")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("preset-enabled-p1"));
    fireEvent.change(screen.getByTestId("preset-generation-settings-p1"), {
      target: { value: "{\"temperature\":0.95,\"top_p\":0.8}" },
    });
    fireEvent.click(screen.getByTestId("preset-regex-disabled-r1"));
    fireEvent.change(screen.getByTestId("preset-regex-replace-r1"), {
      target: { value: "better" },
    });
    fireEvent.click(screen.getByTestId("preset-save-p1"));

    await waitFor(() => {
      const put = calls.find((call) => String(call[0]).endsWith("/presets/p1"));
      expect(put).toBeTruthy();
      const body = JSON.parse(put![1]!.body as string);
      expect(body.enabled).toBe(false);
      expect(body.generationSettings).toEqual({ temperature: 0.95, top_p: 0.8 });
      expect(body.regexScripts[0]).toMatchObject({
        id: "r1",
        replaceString: "better",
        disabled: true,
      });
    });
  });
});
