import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function readClientSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf-8");
}

describe("AI entrypoint guard", () => {
  it("conversation pane sends AI turns through the unified agent endpoint", () => {
    const source = readClientSource("src/components/conversation/conversation-pane.tsx");

    expect(source).toContain("/agent/run");
    expect(source).not.toContain("/conversation?mode=chat");
    expect(source).not.toContain("/auto`");
    expect(source).not.toContain("/auto/cancel");
    expect(source).not.toContain("parseSlashCommand(content)");
  });

  it("conversation runtime does not use legacy SSE tool workflow events", () => {
    const pane = readClientSource("src/components/conversation/conversation-pane.tsx");
    const message = readClientSource("src/components/conversation/message.tsx");
    const streaming = readClientSource("src/components/conversation/streaming-message.tsx");
    const combined = [pane, message, streaming].join("\n");

    expect(combined).not.toContain("WRITING_TOOLS");
    expect(combined).not.toContain("tool_call_start");
    expect(combined).not.toContain("tool_call_end");
    expect(combined).not.toContain("auto_status");
    expect(combined).not.toContain("acceptance_report");
    expect(combined).not.toContain("chapter_write");
    expect(combined).not.toContain("record_chapter_state");
  });

  it("editor pane does not call legacy split write/finalize endpoints", () => {
    const source = readClientSource("src/components/editor/editor-pane.tsx");

    expect(source).not.toContain("/write-draft");
    expect(source).not.toContain("/finalize");
  });

  it("client source does not call legacy AI endpoints directly", () => {
    const root = resolve(process.cwd(), "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
      }
    };
    walk(root);

    const sources = files.map((file) => ({
      file,
      source: readFileSync(file, "utf-8"),
    }));
    const combined = sources.map((item) => item.source).join("\n");
    expect(combined).not.toContain("/conversation?mode=chat");
    expect(combined).not.toContain("/auto/cancel");
    for (const item of sources) {
      const legacyOnboardAiCall = item.source
        .split(/\r?\n/)
        .filter((line) => line.includes("/onboard") && !line.includes("/onboard-status") && !line.includes("/onboard/skip"))
        .filter((line) => /fetch|jsonFetch|startSseStream|streamSse|url:/.test(line));
      expect(legacyOnboardAiCall, item.file).toEqual([]);
    }
    expect(combined).not.toContain("/chapters/${props.chapterNo}/revise-segment");
    expect(combined).not.toContain("/chapters/${props.chapterNo}/apply-revision");
    expect(combined).not.toContain("/write-draft");
    expect(combined).not.toContain("/finalize");
  });
});
