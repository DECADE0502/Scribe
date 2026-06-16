import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImportDialog } from "../../src/components/import/import-dialog.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data } as Response;
}

describe("ImportDialog", () => {
  it("previews a SillyTavern JSON file and imports it", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).endsWith("/preview")) {
        return jsonResponse({
          sourceType: "sillytavern_worldbook",
          sourceName: "Worldbook",
          stats: { entryCount: 38, constantCount: 7 },
          warnings: [],
        });
      }
      return jsonResponse({
        sourceType: "sillytavern_worldbook",
        imported: { worldbookEntries: 38, promptPresets: 0, promptBlocks: 0 },
      }, 201);
    });

    const onImported = vi.fn();
    render(<ImportDialog bookId="book-1" onImported={onImported} />);
    const file = new File([JSON.stringify({ entries: {} })], "worldbook.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByTestId("import-file"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(screen.getByText("sillytavern_worldbook")).toBeInTheDocument());
    expect(screen.getByText(/38/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("import-confirm"));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(calls.some(([url]) => url.endsWith("/imports"))).toBe(true);
  });
});
