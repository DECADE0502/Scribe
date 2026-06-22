import { describe, it, expect } from "vitest";
import { renderGoalAndProgress } from "../../../../src/ai/context-builder/book-context.js";

function repo(meta: Record<string, string>) {
  return { get: (k: string) => meta[k] };
}

describe("renderGoalAndProgress", () => {
  it("未设置任何目标时返回 undefined(不注入)", () => {
    expect(renderGoalAndProgress(repo({}), 3)).toBeUndefined();
  });

  it("给出目标章数时计算进度百分比并给开篇节奏提示", () => {
    const text = renderGoalAndProgress(
      repo({ goal_form: "长篇连载", goal_target_chapters: "100" }),
      5,
    );
    expect(text).toContain("创作目标与进度");
    expect(text).toContain("长篇连载");
    expect(text).toContain("约 100 章");
    expect(text).toContain("第 5 章");
    expect(text).toContain("5%");
    expect(text).toContain("开篇铺垫"); // 5/100 = 5% ≤ 15%
  });

  it("临近结尾给出收束提示", () => {
    const text = renderGoalAndProgress(repo({ goal_target_chapters: "10" }), 9);
    expect(text).toContain("90%");
    expect(text).toContain("接近全书结尾");
  });

  it("中段给出推进提示", () => {
    const text = renderGoalAndProgress(repo({ goal_target_chapters: "10" }), 5);
    expect(text).toContain("故事中段");
  });

  it("含结局/续集字段会注入", () => {
    const text = renderGoalAndProgress(
      repo({ goal_ending: "沈砚查明真相后归隐", goal_sequel: "预留续集钩子" }),
      2,
    );
    expect(text).toContain("沈砚查明真相后归隐");
    expect(text).toContain("预留续集钩子");
  });
});
