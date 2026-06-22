import { describe, it, expect } from "vitest";
import {
  parseAuditOutput,
  AUDIT_SUMMARIZE_PROMPT,
} from "../../../../src/ai/prompts/audit-summarize.js";

const validOutput = {
  verdict: "ok",
  issues: [
    { dimension: "setting_consistency", severity: "ok", score: 9, note: "无明显问题" },
    { dimension: "character_behavior", severity: "ok", score: 8, note: "符合人设" },
    { dimension: "pacing", severity: "ok", score: 8, note: "节奏稳" },
    { dimension: "narrative_coherence", severity: "ok", score: 9, note: "衔接自然" },
    { dimension: "foreshadowing", severity: "ok", score: 7, note: "无新伏笔" },
    { dimension: "hook_strength", severity: "warning", score: 6, note: "钩子稍弱" },
    { dimension: "aesthetic_quality", severity: "ok", score: 8, note: "细节扎实" },
  ],
  summary: {
    oneLiner: "林尘进城遭遇师妹,误会拂袖",
    paragraph:
      "本章林尘携密信进入云上城,在城门口与师妹擦肩。两人因前事产生短暂误会,师妹拂袖而去。林尘内心震动但表面克制,继续前往任务点。本章末尾揭示密信被人调换,埋下后续追查线索。".repeat(
        2,
      ),
    keyEvents: [
      { event: "林尘进城", characters: ["林尘"], foreshadowingRefs: [] },
      {
        event: "与师妹误会",
        characters: ["林尘", "师妹"],
        foreshadowingRefs: ["未明说的旧账"],
      },
    ],
  },
};

describe("AUDIT_SUMMARIZE_PROMPT", () => {
  it("是非空字符串,包含 7 维度提示", () => {
    expect(AUDIT_SUMMARIZE_PROMPT.length).toBeGreaterThan(100);
    expect(AUDIT_SUMMARIZE_PROMPT).toContain("setting_consistency");
    expect(AUDIT_SUMMARIZE_PROMPT).toContain("aesthetic_quality");
  });

  it("requires reader-continuity checks for POV and narrative perspective drift", () => {
    expect(AUDIT_SUMMARIZE_PROMPT).toContain("reader continuity");
    expect(AUDIT_SUMMARIZE_PROMPT).toContain("POV drift");
    expect(AUDIT_SUMMARIZE_PROMPT).toContain("narrative perspective");
  });

  it("requires auditing vague serialized-novel endings", () => {
    expect(AUDIT_SUMMARIZE_PROMPT).toContain("SERIAL_CHAPTER_ENDING_RULE");
    expect(AUDIT_SUMMARIZE_PROMPT).toContain("连续小说");
    expect(AUDIT_SUMMARIZE_PROMPT).toContain("待续式");
    expect(AUDIT_SUMMARIZE_PROMPT).toContain("hook_strength");
    expect(AUDIT_SUMMARIZE_PROMPT).toContain("aesthetic_quality");
  });
});

describe("parseAuditOutput", () => {
  it("合法 JSON 字符串解析成功", () => {
    const out = parseAuditOutput(JSON.stringify(validOutput));
    expect(out.verdict).toBe("ok");
    expect(out.issues).toHaveLength(7);
    expect(out.summary.oneLiner).toContain("林尘");
  });

  it("硬事实 factType 越界(如模型输出 time)被丢弃,但审查不再整体失败(回归 /audit audit_failed)", () => {
    const withTime = {
      ...validOutput,
      hardFacts: [
        { entity: "案发", attribute: "时间", value: { text: "五年前" }, factType: "time", scope: "book", evidence: "笔录" },
      ],
    };
    const out = parseAuditOutput(JSON.stringify(withTime));
    expect(out.verdict).toBe("ok");          // 此前这里会抛 ZodError → audit_failed
    expect(out.hardFacts).toHaveLength(0);    // 越界条目被丢弃,不拖垮审查
  });

  it("越界/畸形的硬事实条目被丢弃,但整份审查仍解析成功(verdict/summary 不受影响)", () => {
    const withBad = {
      ...validOutput,
      hardFacts: [
        { entity: "剑", attribute: "数量", value: { quantity: 1 }, factType: "quantity", scope: "character", evidence: "x" },
        { entity: "坏", attribute: "坏", value: { text: "x" }, factType: "不存在的类型", scope: "book", evidence: "x" },
        { entity: "缺字段" }, // 畸形
      ],
    };
    const out = parseAuditOutput(JSON.stringify(withBad));
    expect(out.verdict).toBe("ok");          // 核心审查不受影响
    expect(out.summary.oneLiner).toContain("林尘");
    expect(out.hardFacts).toHaveLength(1);    // 只保留合法那条
    expect(out.hardFacts![0]!.factType).toBe("quantity");
  });

  it("剥 ```json 围栏后能解析", () => {
    const wrapped = "```json\n" + JSON.stringify(validOutput) + "\n```";
    const out = parseAuditOutput(wrapped);
    expect(out.verdict).toBe("ok");
  });

  it("剥 ``` 围栏(无 json 标识)也能解析", () => {
    const wrapped = "```\n" + JSON.stringify(validOutput) + "\n```";
    const out = parseAuditOutput(wrapped);
    expect(out.verdict).toBe("ok");
  });

  it("verdict 非法值抛错", () => {
    const bad = { ...validOutput, verdict: "fatal" };
    expect(() => parseAuditOutput(JSON.stringify(bad))).toThrow();
  });

  it("dimension 非法 enum 抛错", () => {
    const bad = {
      ...validOutput,
      issues: [{ ...validOutput.issues[0], dimension: "vibes" }],
    };
    expect(() => parseAuditOutput(JSON.stringify(bad))).toThrow();
  });

  it("非 JSON 字符串抛中文错误", () => {
    expect(() => parseAuditOutput("这不是 JSON")).toThrow(/JSON 解析失败/);
  });

  it("缺 summary 字段抛错", () => {
    const bad: any = { ...validOutput };
    delete bad.summary;
    expect(() => parseAuditOutput(JSON.stringify(bad))).toThrow();
  });

  it("oneLiner 太长(>60)抛错", () => {
    const bad = {
      ...validOutput,
      summary: { ...validOutput.summary, oneLiner: "x".repeat(61) },
    };
    expect(() => parseAuditOutput(JSON.stringify(bad))).toThrow();
  });
});
