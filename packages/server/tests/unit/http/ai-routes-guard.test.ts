import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function readServerSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf-8");
}

/**
 * 防回潮守卫:任务分派架构(2026-07-02)下,AI 执行只有一个入口
 * /agent/run(dispatchTask),其余路由不得携带任何 AI 执行逻辑,
 * 旧 4-agent 管线的 410 stub 也不允许复活(直接 404 即可)。
 */
describe("AI route guard", () => {
  it("conversation route is history-only (GET), no POST, no AI execution", () => {
    const source = readServerSource("src/http/routes/conversation.ts");

    expect(source).toContain('app.get("/api/books/:bookId/conversation"');
    expect(source).not.toContain("app.post(");
    expect(source).not.toContain("dispatchTask");
    expect(source).not.toContain("runAgentWorkflow");
  });

  it("chapter routes are pure CRUD — legacy write/draft/finalize routes stay deleted", () => {
    const source = readServerSource("src/http/routes/chapters.ts");

    expect(source).not.toContain("/chapters/:no/write");
    expect(source).not.toContain("/chapters/:no/finalize");
    expect(source).not.toContain("legacy_write_route_removed");
    expect(source).not.toContain("dispatchTask");
    expect(source).not.toContain("writeWithAudit(");
    expect(source).not.toContain("auditChapter(");
    expect(source).not.toContain("recordChapterState(");
  });

  it("legacy auto/revise route files stay deleted", () => {
    expect(existsSync(resolve(process.cwd(), "src/http/routes/auto.ts"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/http/routes/revise.ts"))).toBe(false);
  });

  it("books route has no onboard POST — onboarding goes through /agent/run", () => {
    const source = readServerSource("src/http/routes/books.ts");

    expect(source).not.toContain('app.post("/api/books/:bookId/onboard"');
    expect(source).not.toContain("legacy_onboard_route_removed");
    expect(source).not.toContain("dispatchTask");
  });

  it("worldbook routes have no chat endpoint", () => {
    const source = readServerSource("src/http/routes/worldbook.ts");

    expect(source).not.toContain("/worldbook/chat");
    expect(source).not.toContain("dispatchTask");
  });

  it("agent route is the only HTTP route that owns task dispatch, with no staging endpoints", () => {
    const source = readServerSource("src/http/routes/agent.ts");

    expect(source).toContain("dispatchTask");
    expect(source).toContain("/api/books/:bookId/agent/run");
    // staging/approve/cancel 概念已随 workflow_runs 一起删除
    expect(source).not.toContain("/agent/runs/");
    expect(source).not.toContain("workflow-staging");
    expect(source).not.toContain("workflow-runs");
  });

  it("the five task files own AI execution and register through the registry", () => {
    const registry = readServerSource("src/ai/tasks/registry.ts");
    for (const task of ["writeChapterTask", "reviseTask", "onboardTask", "chatTask", "auditTask"]) {
      expect(registry).toContain(task);
    }
    for (const file of ["write-chapter.ts", "revise.ts", "onboard.ts", "chat.ts", "audit.ts"]) {
      expect(existsSync(resolve(process.cwd(), `src/ai/tasks/${file}`))).toBe(true);
    }
  });
});
