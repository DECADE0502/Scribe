import { describe, it, expect } from "vitest";
import { GenreSectionSchema } from "../src/types/genre-section.js";

describe("GenreSectionSchema", () => {
  const baseSection = {
    id: "x",
    name: "功法",
    createdBy: "ai" as const,
    createdAt: 1,
  };

  it("接受简单 type:string", () => {
    GenreSectionSchema.parse({
      ...baseSection,
      schema: [{ name: "tier", type: "string", required: true }],
    });
  });

  it("接受新式 enum 对象,values >= 2", () => {
    GenreSectionSchema.parse({
      ...baseSection,
      schema: [
        {
          name: "tier",
          type: { kind: "enum", values: ["下品", "中品", "上品"] },
          required: true,
        },
      ],
    });
  });

  it("拒绝新式 enum 少于 2 个 values", () => {
    expect(() =>
      GenreSectionSchema.parse({
        ...baseSection,
        schema: [{ name: "tier", type: { kind: "enum", values: ["仅一项"] } }],
      }),
    ).toThrow();
  });

  it("拒绝未知 type", () => {
    expect(() =>
      GenreSectionSchema.parse({
        ...baseSection,
        schema: [{ name: "x", type: "magic" }],
      }),
    ).toThrow();
  });

  it("接受 ref:character", () => {
    GenreSectionSchema.parse({
      ...baseSection,
      schema: [{ name: "owner", type: "ref:character" }],
    });
  });

  it("接受 ref:section:功法", () => {
    GenreSectionSchema.parse({
      ...baseSection,
      schema: [{ name: "起源功法", type: "ref:section:功法" }],
    });
  });

  it("接受 list:ref:character", () => {
    GenreSectionSchema.parse({
      ...baseSection,
      schema: [{ name: "传人", type: "list:ref:character" }],
    });
  });

  it("接受 list:ref:section:法器", () => {
    GenreSectionSchema.parse({
      ...baseSection,
      schema: [{ name: "佩剑", type: "list:ref:section:法器" }],
    });
  });

  it("拒绝空 schema 数组", () => {
    expect(() =>
      GenreSectionSchema.parse({
        ...baseSection,
        schema: [],
      }),
    ).toThrow();
  });

  it("name 必须非空", () => {
    expect(() =>
      GenreSectionSchema.parse({
        ...baseSection,
        name: "",
        schema: [{ name: "x", type: "string" }],
      }),
    ).toThrow();
  });
});

import { resolveLabelFieldName, resolveItemLabel } from "../src/types/genre-section.js";

describe("resolveLabelFieldName / resolveItemLabel(显示名声明,不猜字段名)", () => {
  it("优先用显式声明的 isLabel 字段", () => {
    const schema = [
      { name: "属性", type: "string" as const },
      { name: "功法名", type: "string" as const, required: true, isLabel: true },
    ];
    expect(resolveLabelFieldName(schema)).toBe("功法名");
    expect(resolveItemLabel(schema, { 功法名: "吞天诀", 属性: "魔道" })).toBe("吞天诀");
  });

  it("未声明 isLabel 时退到第一个必填字段", () => {
    const schema = [
      { name: "描述", type: "string" as const },
      { name: "名称", type: "string" as const, required: true },
    ];
    expect(resolveLabelFieldName(schema)).toBe("名称");
  });

  it("既无 isLabel 又无必填时退到第一个字段", () => {
    const schema = [{ name: "代号", type: "string" as const }, { name: "x", type: "string" as const }];
    expect(resolveLabelFieldName(schema)).toBe("代号");
  });

  it("data 缺显示名字段时退到第一个非空值,再退到 fallback", () => {
    const schema = [{ name: "名称", type: "string" as const, isLabel: true }];
    expect(resolveItemLabel(schema, { 别的: "有值" })).toBe("有值");
    expect(resolveItemLabel(schema, {}, "(空)")).toBe("(空)");
  });

  it("任意题材自定义字段名都能解析(星舰型号)", () => {
    const schema = [
      { name: "星舰型号", type: "string" as const, isLabel: true },
      { name: "武备", type: "string" as const },
    ];
    expect(resolveItemLabel(schema, { 星舰型号: "曲率-7", 武备: "离子炮" })).toBe("曲率-7");
  });
});
