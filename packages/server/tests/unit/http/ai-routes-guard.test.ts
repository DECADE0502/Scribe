import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readServerSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf-8");
}

describe("AI route guard", () => {
  it("conversation route is history-only and does not execute AI workflows", () => {
    const source = readServerSource("src/http/routes/conversation.ts");

    expect(source).toContain("legacy_conversation_post_removed");
    expect(source).not.toContain("runAgentWorkflow");
    expect(source).not.toContain("runConversation(");
  });

  it("chapter AI routes do not call legacy write/audit/record flows directly", () => {
    const source = readServerSource("src/http/routes/chapters.ts");

    expect(source).toContain("legacy_write_route_removed");
    expect(source).toContain("legacy_write_draft_route_removed");
    expect(source).toContain("legacy_finalize_route_removed");
    expect(source).not.toContain("write chapter");
    expect(source).not.toContain("draft chapter");
    expect(source).not.toContain("finalize chapter");
    expect(source).not.toContain("writeWithAudit(");
    expect(source).not.toContain("writeChapterSimple(");
    expect(source).not.toContain("auditChapter(");
    expect(source).not.toContain("repairChapter(");
    expect(source).not.toContain("recordChapterState(");
  });

  it("auto route does not call the legacy auto mode directly", () => {
    const source = readServerSource("src/http/routes/auto.ts");

    expect(source).toContain("legacy_auto_route_removed");
    expect(source).not.toContain("runAgentWorkflow");
    expect(source).not.toContain("runAutoMode(");
    expect(source).not.toContain("recordChapterState(");
  });

  it("onboard route does not call the legacy new-book conversation directly", () => {
    const source = readServerSource("src/http/routes/books.ts");

    expect(source).toContain("legacy_onboard_route_removed");
    expect(source).not.toContain("runAgentWorkflow");
    expect(source).not.toContain("runNewBookConversation(");
  });

  it("worldbook chat route does not call the legacy worldbook chat directly", () => {
    const source = readServerSource("src/http/routes/worldbook.ts");

    expect(source).toContain("legacy_worldbook_chat_removed");
    expect(source).not.toContain("runAgentWorkflow");
    expect(source).not.toContain("runWorldbookChat(");
  });

  it("revision AI routes do not call legacy revise/apply flows directly", () => {
    const source = readServerSource("src/http/routes/revise.ts");

    expect(source).toContain("legacy_revise_segment_removed");
    expect(source).toContain("legacy_apply_revision_removed");
    expect(source).not.toContain("runAgentWorkflow");
    expect(source).not.toContain("reviseSegment(");
    expect(source).not.toContain("chaptersRepo.saveVersion(");
    expect(source).not.toContain("chapterFiles.save(");
  });

  it("agent route is the only HTTP route that owns the unified agent workflow", () => {
    const source = readServerSource("src/http/routes/agent.ts");

    expect(source).toContain("runAgentWorkflow");
    expect(source).toContain("/api/books/:bookId/agent/run");
  });
});
