import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorldbookPanel } from "../../src/components/worldbook/worldbook-panel.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data } as Response;
}

describe("WorldbookPanel", () => {
  it("lists entries, creates entries, and toggles constant/triggered mode", async () => {
    const entries = [{
      id: "w1",
      title: "Core contract",
      content: "Keep close third person narration.",
      enabled: true,
      activation: "constant",
      keys: [],
      secondaryKeys: [],
      constant: true,
      priority: 100,
      insertionDepth: 0,
      recursive: false,
      recursionLimit: 0,
      tokenBudget: null,
      category: "style",
      metadata: {},
      createdAt: 1,
      updatedAt: 1,
    }];
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (init?.method === "POST") {
        return jsonResponse({ entry: { ...entries[0], id: "w2", title: "Harbor rule" } }, 201);
      }
      return jsonResponse({ entries });
    });

    render(<WorldbookPanel bookId="book-1" />);

    await waitFor(() => expect(screen.getByText("Core contract")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("worldbook-new"));
    fireEvent.change(screen.getByTestId("worldbook-title"), {
      target: { value: "Harbor rule" },
    });
    fireEvent.change(screen.getByTestId("worldbook-content"), {
      target: { value: "The harbor has pressure bells." },
    });
    fireEvent.change(screen.getByTestId("worldbook-activation"), {
      target: { value: "triggered" },
    });
    fireEvent.change(screen.getByTestId("worldbook-keys"), {
      target: { value: "harbor, pressure bells" },
    });
    fireEvent.click(screen.getByTestId("worldbook-recursive"));
    fireEvent.click(screen.getByTestId("worldbook-submit"));

    await waitFor(() => {
      const post = calls.find((call) => call[1]?.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(post![1]!.body as string);
      expect(body.title).toBe("Harbor rule");
      expect(body.activation).toBe("triggered");
      expect(body.constant).toBe(false);
      expect(body.keys).toEqual(["harbor", "pressure bells"]);
      expect(body.recursive).toBe(true);
    });
  });

  it("edits SillyTavern metadata and previews trigger diagnostics", async () => {
    const entries = [{
      id: "w1",
      title: "Capture rule",
      content: "Capture requires status bar continuity.",
      enabled: true,
      activation: "triggered",
      keys: ["capture"],
      secondaryKeys: ["status bar"],
      constant: false,
      priority: 100,
      insertionDepth: 0,
      recursive: false,
      recursionLimit: 0,
      tokenBudget: null,
      category: "system",
      metadata: {
        sillytavern: {
          selective: false,
          probability: 100,
          useProbability: true,
          scanDepth: 10,
          rawEntry: { id: 1 },
        },
      },
      createdAt: 1,
      updatedAt: 1,
    }];
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).endsWith("/preview")) {
        return jsonResponse({
          selected: [{
            entry: entries[0],
            matchedKeys: ["capture", "status bar"],
            reason: "trigger",
            recursionDepth: 0,
          }],
          diagnostics: [{
            entryId: "w1",
            title: "Capture rule",
            matchedKeys: ["capture", "status bar"],
            reason: "trigger",
            decision: "selected",
            recursionDepth: 0,
            notes: [],
          }],
          rendered: "Capture requires status bar continuity.",
        });
      }
      if (init?.method === "PUT") {
        return jsonResponse({ entry: entries[0] });
      }
      return jsonResponse({ entries });
    });

    render(<WorldbookPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByText("Capture rule")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getByTestId("worldbook-st-selective"));
    fireEvent.change(screen.getByTestId("worldbook-st-probability"), {
      target: { value: "80" },
    });
    fireEvent.change(screen.getByTestId("worldbook-st-scan-depth"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByTestId("worldbook-submit"));

    await waitFor(() => {
      const put = calls.find((call) => call[1]?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(put![1]!.body as string);
      expect(body.metadata.sillytavern).toMatchObject({
        selective: true,
        probability: 80,
        scanDepth: 4,
        rawEntry: { id: 1 },
      });
    });

    fireEvent.change(screen.getByTestId("worldbook-preview-query"), {
      target: { value: "capture status bar" },
    });
    fireEvent.click(screen.getByTestId("worldbook-preview-run"));
    await waitFor(() =>
      expect(screen.getByText(/Capture rule: trigger \/ capture, status bar/))
        .toBeInTheDocument(),
    );
  });
});
