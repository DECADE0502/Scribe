import { describe, it, expect } from "vitest";
import {
  auditChapter,
  buildAuditUserPrompt,
} from "../../../../src/ai/orchestrator/audit-chapter.js";

const okOutput = {
  verdict: "ok",
  issues: Array.from({ length: 7 }, (_, i) => ({
    dimension: [
      "setting_consistency",
      "character_behavior",
      "pacing",
      "narrative_coherence",
      "foreshadowing",
      "hook_strength",
      "aesthetic_quality",
    ][i],
    severity: "ok",
    score: 8,
    note: "ok",
  })),
  summary: {
    oneLiner: "测试一句话",
    paragraph: "测试摘要".repeat(20),
    keyEvents: [{ event: "测试事件", characters: ["A"], foreshadowingRefs: [] }],
  },
};

function makeAuditModel(text: string, opts: { throwError?: Error } = {}): any {
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-audit",
    async doGenerate() {
      if (opts.throwError) throw opts.throwError;
      return {
        text,
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 200 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      throw new Error("audit 用 generateText 不走流");
    },
  };
}

describe("auditChapter", () => {
  it("正常路径返回结构化结果 + usage", async () => {
    const model = makeAuditModel(JSON.stringify(okOutput));
    const r = await auditChapter(
      { model },
      {
        chapterNo: 1,
        chapterContent: "正文",
      },
    );
    expect(r.output.verdict).toBe("ok");
    expect(r.output.issues).toHaveLength(7);
    expect(r.usage.promptTokens).toBe(100);
    expect(r.usage.completionTokens).toBe(200);
  });

  it("LLM 返围栏包裹的 JSON 也能解析", async () => {
    const model = makeAuditModel(
      "```json\n" + JSON.stringify(okOutput) + "\n```",
    );
    const r = await auditChapter(
      { model },
      { chapterNo: 1, chapterContent: "正文" },
    );
    expect(r.output.verdict).toBe("ok");
  });

  it("LLM 返非法 JSON 抛 ParseError", async () => {
    const model = makeAuditModel("not a json");
    await expect(
      auditChapter({ model }, { chapterNo: 1, chapterContent: "正文" }),
    ).rejects.toThrow(/JSON 解析失败/);
  });

  it("verdict critical 也能解析", async () => {
    const critical = {
      ...okOutput,
      verdict: "critical",
      issues: [
        { ...okOutput.issues[0], severity: "critical" },
        ...okOutput.issues.slice(1),
      ],
    };
    const model = makeAuditModel(JSON.stringify(critical));
    const r = await auditChapter(
      { model },
      { chapterNo: 1, chapterContent: "x" },
    );
    expect(r.output.verdict).toBe("critical");
  });
});

describe("buildAuditUserPrompt", () => {
  it("拼接 premise + characters + foreshadowing 的中文段落", () => {
    const text = buildAuditUserPrompt({
      chapterNo: 3,
      chapterContent: "本章正文",
      premise: "故事前提",
      characters: [
        { name: "林尘", baseData: { background: "弃婴", motivation: "复仇" } },
      ],
      activeForeshadowing: [
        { label: "黑剑", description: "出处不明的剑", status: "active" },
      ],
    });
    expect(text).toContain("## 第 3 章正文");
    expect(text).toContain("本章正文");
    expect(text).toContain("## 故事前提");
    expect(text).toContain("## 主要角色");
    expect(text).toContain("林尘");
    expect(text).toContain("背景:弃婴");
    expect(text).toContain("## 活跃伏笔");
    expect(text).toContain("[黑剑] 出处不明的剑(状态:active)");
  });

  it("缺字段时不输出对应段落", () => {
    const text = buildAuditUserPrompt({ chapterNo: 1, chapterContent: "x" });
    expect(text).not.toContain("## 故事前提");
    expect(text).not.toContain("## 主要角色");
    expect(text).not.toContain("## 活跃伏笔");
  });
});
