import { describe, it, expect } from "vitest";
import { ProjectName, smokeTest } from "../src/index.js";

describe("shared smoke", () => {
  it("项目名为 scribe", () => {
    expect(ProjectName).toBe("scribe");
  });
  it("smokeTest 返回 ok", () => {
    expect(smokeTest()).toBe("ok");
  });
});
