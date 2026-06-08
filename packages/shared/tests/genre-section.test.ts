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
