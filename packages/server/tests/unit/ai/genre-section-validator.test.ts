import { describe, it, expect } from "vitest";
import {
  validateItemAgainstSchema,
  ValidationError,
} from "../../../src/ai/genre-section-validator.js";
import type { GenreSection } from "@scribe/shared";

const sec = (schema: any[]): GenreSection => ({
  id: "s1",
  name: "功法",
  schema,
  createdBy: "ai",
  createdAt: 1,
});

describe("validateItemAgainstSchema", () => {
  it("required 缺失抛错", () => {
    const s = sec([{ name: "name", type: "string", required: true }]);
    expect(() => validateItemAgainstSchema(s, {})).toThrow(ValidationError);
  });

  it("required 字段 null 也算缺失", () => {
    const s = sec([{ name: "name", type: "string", required: true }]);
    expect(() => validateItemAgainstSchema(s, { name: null })).toThrow(/必填/);
  });

  it("type:string 不接受数字", () => {
    const s = sec([{ name: "x", type: "string", required: true }]);
    expect(() => validateItemAgainstSchema(s, { x: 1 })).toThrow(/应为字符串/);
  });

  it("type:number 接受数字", () => {
    const s = sec([{ name: "n", type: "number", required: true }]);
    validateItemAgainstSchema(s, { n: 3 });
  });

  it("enum 对象式:值不在列表抛错", () => {
    const s = sec([
      {
        name: "tier",
        type: { kind: "enum", values: ["A", "B"] },
        required: true,
      },
    ]);
    expect(() => validateItemAgainstSchema(s, { tier: "C" })).toThrow(
      /不在允许列表/,
    );
    validateItemAgainstSchema(s, { tier: "A" });
  });

  it("ref:character 需要 charactersRepo,目标存在则通过", () => {
    const s = sec([{ name: "owner", type: "ref:character", required: true }]);
    const charactersRepo = {
      get: (id: string) => (id === "林尘" ? { id: "林尘" } : undefined),
    };
    validateItemAgainstSchema(s, { owner: "林尘" }, charactersRepo);
  });

  it("ref:character 目标不存在抛错", () => {
    const s = sec([{ name: "owner", type: "ref:character", required: true }]);
    const charactersRepo = { get: () => undefined };
    expect(() =>
      validateItemAgainstSchema(s, { owner: "幽灵" }, charactersRepo),
    ).toThrow(/角色 ID 幽灵 不存在/);
  });

  it("list:string 接受字符串数组", () => {
    const s = sec([{ name: "tags", type: "list:string", required: true }]);
    validateItemAgainstSchema(s, { tags: ["a", "b"] });
    expect(() => validateItemAgainstSchema(s, { tags: [1, 2] })).toThrow(
      /元素应为 string/,
    );
  });

  it("list:ref:character 验每个元素", () => {
    const s = sec([
      { name: "传人", type: "list:ref:character", required: true },
    ]);
    const charactersRepo = {
      get: (id: string) => (id === "林尘" ? { id: "林尘" } : undefined),
    };
    validateItemAgainstSchema(s, { 传人: ["林尘"] }, charactersRepo);
    expect(() =>
      validateItemAgainstSchema(s, { 传人: ["李四"] }, charactersRepo),
    ).toThrow(/不存在/);
  });

  it("ref:section:<name> 验目标条目存在", () => {
    const s = sec([
      { name: "起源", type: "ref:section:法器", required: true },
    ]);
    const sectionsRepo = {
      getByName: (n: string) => (n === "法器" ? { id: "fq" } : undefined),
      listItems: (sid: string) => (sid === "fq" ? [{ id: "i1" }] : []),
    };
    validateItemAgainstSchema(s, { 起源: "i1" }, undefined, sectionsRepo);
    expect(() =>
      validateItemAgainstSchema(s, { 起源: "i2" }, undefined, sectionsRepo),
    ).toThrow(/条目 i2 不存在/);
  });

  it("data 中多余字段不抛错(向后兼容)", () => {
    const s = sec([{ name: "name", type: "string", required: true }]);
    validateItemAgainstSchema(s, {
      name: "x",
      legacy: "也存在但不在 schema",
    });
  });
});
