import { describe, expect, it } from "vitest";
import {
  parseJsonArray,
  parseJsonField,
  parseNullableObject,
} from "../../../src/db/json-utils.js";

describe("parseJsonField", () => {
  it("解析正常 JSON 字符串", () => {
    expect(parseJsonField<{ a: number }>('{"a":1}', { a: 0 })).toEqual({ a: 1 });
  });
  it("NULL → fallback", () => {
    expect(parseJsonField<number[]>(null, [])).toEqual([]);
  });
  it("undefined → fallback", () => {
    expect(parseJsonField<number[]>(undefined, [])).toEqual([]);
  });
  it("空串 → fallback", () => {
    expect(parseJsonField<number[]>("", [])).toEqual([]);
  });
  it("非字符串 → fallback", () => {
    expect(parseJsonField<number[]>(123, [])).toEqual([]);
  });
  it("解析失败 → fallback", () => {
    expect(parseJsonField<{ a: number }>("not-json", { a: 0 })).toEqual({ a: 0 });
  });
});

describe("parseJsonArray", () => {
  it("解析正常数组", () => {
    expect(parseJsonArray<string>('["x","y"]')).toEqual(["x", "y"]);
  });
  it("NULL → 空数组", () => {
    expect(parseJsonArray<string>(null)).toEqual([]);
  });
  it("空串 → 空数组", () => {
    expect(parseJsonArray<string>("")).toEqual([]);
  });
  it("解析后非数组 → 空数组", () => {
    expect(parseJsonArray<string>('{"a":1}')).toEqual([]);
  });
  it("解析失败 → 空数组", () => {
    expect(parseJsonArray<string>("oops")).toEqual([]);
  });
});

describe("parseNullableObject", () => {
  it("解析正常对象", () => {
    expect(parseNullableObject('{"k":"v"}')).toEqual({ k: "v" });
  });
  it("NULL → null", () => {
    expect(parseNullableObject(null)).toBeNull();
  });
  it("空串 → null", () => {
    expect(parseNullableObject("")).toBeNull();
  });
  it("解析后 JSON null → null", () => {
    expect(parseNullableObject("null")).toBeNull();
  });
  it("解析失败 → null", () => {
    expect(parseNullableObject("nope")).toBeNull();
  });
});
