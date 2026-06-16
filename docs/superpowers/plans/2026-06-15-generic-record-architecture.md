# Generic Record Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the current genre-section state system into a fully generic, declaration-driven record architecture where local code only provides universal collection, field, item, relation, upsert, and recall primitives, while the AI decides what domain records to create and maintain for each book.

**Architecture:** Keep the current SQLite-backed repos and AI tool pattern, but replace the "genre section" mental model with generic record collections. Schemas become explicit declarations: fields have universal roles, collections define identity/display/search behavior, and item writes are upserts keyed by declared identity fields. Prompts stop listing topic-specific record classes as system logic; instead they instruct the AI to infer required collections from the book and maintain them through generic tools.

**Tech Stack:** TypeScript, Zod, Vitest, Hono, SQLite via better-sqlite3, Vercel AI SDK tools, React.

---

## Final Goal

The final state is:

- Local server code has no hard-coded domain taxonomy such as cultivation, artifacts, powers, factions, finance, relationships, or similar topic-specific branches.
- AI can create any needed record collection from user setup or chapter content, define fields, evolve schemas, upsert records, and link records using generic tools.
- Scripts and UI read only schema declarations, never guessed field names or field positions.
- Duplicate records are prevented by declared identity fields.
- Relationships between records are represented through declared relation fields and maintained by a generic link/upsert relation tool. The local code validates collection names, identity keys, field roles, and reference types; it never understands what the relationship means in a domain-specific way.
- Record collections and items participate in archive summaries, writing context, and recall.
- Existing books remain readable through a compatibility layer or migration path, but all new writes use the generic model.

## Non-Negotiable Constraints

- Do not encode novel genres, setting types, or book-specific concepts in production logic.
- Do not infer identity, label, or display fields from "first required field" for new schemas.
- Do not let `add` semantics create duplicates when the AI mentions the same record again.
- Do not require the AI to pre-check for duplicates; the local tool must upsert.
- Do not treat relations as prompt-only behavior. If the AI needs to connect two records, there must be a generic local interface that resolves both records by declared identity and writes the relation through schema-declared fields.
- Do not remove specialized stable systems that are genuinely cross-novel and already useful: characters, foreshadowing, timeline, outline. They can coexist with generic records.

## File Structure

- Modify `packages/shared/src/types/genre-section.ts`: introduce the generic record schema types and compatibility aliases.
- Modify `packages/shared/tests/genre-section.test.ts`: cover field roles, identity/display/search helpers, and legacy `isLabel` compatibility.
- Modify `packages/server/src/ai/genre-section-validator.ts`: validate generic collection schema declarations and item data.
- Modify `packages/server/tests/unit/ai/genre-section-validator.test.ts`: enforce declaration rules and item validation behavior.
- Modify `packages/server/src/ai/tools/genre-section-tools.ts`: replace add-only item writes with generic upsert behavior while preserving old tool names as wrappers if needed.
- Modify `packages/server/tests/unit/ai/tools/genre-section-tools.test.ts`: cover schema creation, schema evolution, upsert, duplicate prevention, generic relation linking, and reference validation.
- Modify `packages/server/src/db/repositories/genre-sections.ts`: add lookup helpers for identity-key matching and optional search metadata.
- Modify `packages/server/tests/unit/db/repositories/genre-sections.test.ts`: cover identity lookup and unchanged old row loading.
- Modify `packages/server/src/ai/orchestrator/record-state.ts`: make archive summary declaration-aware and use generic record language in the prompt.
- Modify `packages/server/src/ai/prompts/new-book-onboard.ts`: remove topic-list-driven logic and require AI-inferred generic collections.
- Modify `packages/server/src/ai/context-builder/recall.ts`: add generic record entities to recall scoring.
- Modify `packages/server/src/ai/context-builder/book-context.ts`: derive recall intent from generic record identities and aliases.
- Modify `packages/server/src/ai/context-builder/builder.ts`: render generic record collections with declared display/summary/search fields.
- Modify context-builder tests under `packages/server/tests/unit/ai/context-builder/` and `packages/server/tests/integration/context-builder.test.ts`.
- Modify `packages/client/src/components/sidebar/genre-section-panel.tsx`: render using generic declaration helpers.
- Modify `packages/client/tests/components/genre-section-panel.test.tsx`: cover generic identity/display fields.

---

## Task 1: Shared Generic Record Declarations

**Files:**
- Modify: `packages/shared/src/types/genre-section.ts`
- Test: `packages/shared/tests/genre-section.test.ts`

- [ ] **Step 1: Write failing tests for declared field roles**

Add tests that expect:

```ts
import {
  GenreSectionSchema,
  resolveIdentityFieldNames,
  resolveDisplayFieldNames,
  resolveItemIdentityKey,
  resolveItemLabel,
  resolveItemSearchText,
} from "../src/types/genre-section.js";

it("requires new schemas to declare identity and display roles", () => {
  expect(() =>
    GenreSectionSchema.parse({
      id: "s1",
      name: "任何记录集合",
      createdBy: "ai",
      createdAt: 1,
      identityFields: ["唯一名"],
      displayFields: ["唯一名"],
      searchFields: ["唯一名", "摘要"],
      schema: [
        { name: "唯一名", type: "string", required: true, role: "identity" },
        { name: "摘要", type: "text", role: "summary" },
      ],
    }),
  ).not.toThrow();
});

it("builds identity/display/search from declarations without guessing", () => {
  const schema = [
    { name: "代号", type: "string" as const, required: true, role: "identity" as const },
    { name: "展示", type: "string" as const, role: "label" as const },
    { name: "说明", type: "text" as const, role: "summary" as const },
  ];
  const section = {
    id: "s1",
    name: "自定义集合",
    createdBy: "ai" as const,
    createdAt: 1,
    identityFields: ["代号"],
    displayFields: ["展示"],
    searchFields: ["代号", "展示", "说明"],
    schema,
  };
  expect(resolveIdentityFieldNames(section)).toEqual(["代号"]);
  expect(resolveDisplayFieldNames(section)).toEqual(["展示"]);
  expect(resolveItemIdentityKey(section, { 代号: "A-7", 展示: "七号" })).toBe("代号=A-7");
  expect(resolveItemLabel(section, { 代号: "A-7", 展示: "七号" })).toBe("七号");
  expect(resolveItemSearchText(section, { 代号: "A-7", 展示: "七号", 说明: "可检索文本" })).toContain("可检索文本");
});
```

- [ ] **Step 2: Run the shared tests and verify RED**

Run:

```powershell
pnpm --filter @scribe/shared test -- genre-section.test.ts
```

Expected: FAIL because the helper functions and new schema fields do not exist yet.

- [ ] **Step 3: Implement generic declaration types and helpers**

In `packages/shared/src/types/genre-section.ts`, add:

```ts
export const GenreFieldRoleSchema = z.enum([
  "identity",
  "label",
  "summary",
  "description",
  "status",
  "rank",
  "relation",
  "tag",
  "evidence",
]);

export const GenreSectionFieldSchema = z.object({
  name: z.string().min(1),
  type: GenreFieldTypeSchema,
  role: GenreFieldRoleSchema.optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  isLabel: z.boolean().optional(),
  values: z.array(z.string()).optional(),
});
```

Extend `GenreSectionSchema` with optional arrays:

```ts
identityFields: z.array(z.string().min(1)).optional(),
displayFields: z.array(z.string().min(1)).optional(),
searchFields: z.array(z.string().min(1)).optional(),
```

Add helper functions:

```ts
export function resolveIdentityFieldNames(section: {
  identityFields?: string[];
  schema: Array<{ name: string; role?: string; required?: boolean; isLabel?: boolean }>;
}): string[] {
  const declared = section.identityFields?.filter(Boolean) ?? [];
  if (declared.length) return declared;
  const roleFields = section.schema.filter((f) => f.role === "identity").map((f) => f.name);
  if (roleFields.length) return roleFields;
  const legacy = section.schema.find((f) => f.isLabel)?.name;
  return legacy ? [legacy] : [];
}

export function resolveDisplayFieldNames(section: {
  displayFields?: string[];
  identityFields?: string[];
  schema: Array<{ name: string; role?: string; required?: boolean; isLabel?: boolean }>;
}): string[] {
  const declared = section.displayFields?.filter(Boolean) ?? [];
  if (declared.length) return declared;
  const labels = section.schema.filter((f) => f.role === "label").map((f) => f.name);
  if (labels.length) return labels;
  return resolveIdentityFieldNames(section);
}

export function resolveItemIdentityKey(
  section: { identityFields?: string[]; schema: Array<{ name: string; role?: string; isLabel?: boolean }> },
  data: Record<string, unknown>,
): string | undefined {
  const keys = resolveIdentityFieldNames(section);
  if (!keys.length) return undefined;
  const parts: string[] = [];
  for (const key of keys) {
    const value = data[key];
    if (value === undefined || value === null || value === "") return undefined;
    parts.push(`${key}=${String(value).trim()}`);
  }
  return parts.join("|");
}

export function resolveItemSearchText(
  section: {
    searchFields?: string[];
    displayFields?: string[];
    identityFields?: string[];
    schema: Array<{ name: string; role?: string; isLabel?: boolean }>;
  },
  data: Record<string, unknown>,
): string {
  const declared = section.searchFields?.filter(Boolean) ?? [];
  const roleFields = section.schema
    .filter((f) => ["identity", "label", "summary", "description", "status", "rank", "tag"].includes(f.role ?? ""))
    .map((f) => f.name);
  const fields = [...new Set([...declared, ...roleFields, ...resolveDisplayFieldNames(section)])];
  return fields
    .map((field) => data[field])
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => Array.isArray(value) ? value.join(" ") : String(value))
    .join("\n");
}
```

Update `resolveLabelFieldName` and `resolveItemLabel` so new declarations win, while old `isLabel` remains legacy fallback.

- [ ] **Step 4: Run shared tests and verify GREEN**

Run:

```powershell
pnpm --filter @scribe/shared test -- genre-section.test.ts
```

Expected: PASS for shared genre-section tests.

- [ ] **Step 5: Commit Task 1**

```powershell
git add packages/shared/src/types/genre-section.ts packages/shared/tests/genre-section.test.ts
git commit -m "feat(shared): add generic record declarations"
```

---

## Task 2: Strict Schema Declaration Validator

**Files:**
- Modify: `packages/server/src/ai/genre-section-validator.ts`
- Test: `packages/server/tests/unit/ai/genre-section-validator.test.ts`

- [ ] **Step 1: Write failing tests for schema declaration rules**

Add tests that expect:

```ts
import {
  validateSectionDeclaration,
  ValidationError,
} from "../../../src/ai/genre-section-validator.js";

it("rejects new AI schemas with no identity declaration", () => {
  expect(() =>
    validateSectionDeclaration({
      id: "s",
      name: "任意集合",
      createdBy: "ai",
      createdAt: 1,
      schema: [{ name: "说明", type: "text" }],
    } as any),
  ).toThrow(/identity/);
});

it("rejects identity fields that do not exist in schema", () => {
  expect(() =>
    validateSectionDeclaration({
      id: "s",
      name: "任意集合",
      createdBy: "ai",
      createdAt: 1,
      identityFields: ["不存在"],
      displayFields: ["标题"],
      schema: [{ name: "标题", type: "string", role: "label" }],
    } as any),
  ).toThrow(/不存在/);
});

it("accepts legacy sections that only have isLabel for read compatibility", () => {
  expect(() =>
    validateSectionDeclaration({
      id: "s",
      name: "旧集合",
      createdBy: "ai",
      createdAt: 1,
      schema: [{ name: "名称", type: "string", isLabel: true }],
    } as any, { allowLegacyLabel: true }),
  ).not.toThrow();
});
```

- [ ] **Step 2: Run validator tests and verify RED**

Run:

```powershell
pnpm --filter @scribe/server test -- genre-section-validator.test.ts
```

Expected: FAIL because `validateSectionDeclaration` does not exist.

- [ ] **Step 3: Implement declaration validation**

Add:

```ts
export function validateSectionDeclaration(
  section: GenreSection,
  opts: { allowLegacyLabel?: boolean } = {},
): void {
  const names = new Set(section.schema.map((field) => field.name));
  const identityFields = section.identityFields?.length
    ? section.identityFields
    : section.schema.filter((field) => field.role === "identity").map((field) => field.name);
  const legacyLabel = section.schema.find((field) => field.isLabel)?.name;

  if (!identityFields.length) {
    if (opts.allowLegacyLabel && legacyLabel) return;
    throw new ValidationError("schema 必须声明 identity 字段");
  }

  for (const field of identityFields) {
    if (!names.has(field)) throw new ValidationError(`identity 字段 ${field} 不存在`, field);
  }

  const displayFields = section.displayFields?.length
    ? section.displayFields
    : section.schema.filter((field) => field.role === "label").map((field) => field.name);
  for (const field of displayFields) {
    if (!names.has(field)) throw new ValidationError(`display 字段 ${field} 不存在`, field);
  }
}
```

- [ ] **Step 4: Run validator tests and verify GREEN**

Run:

```powershell
pnpm --filter @scribe/server test -- genre-section-validator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add packages/server/src/ai/genre-section-validator.ts packages/server/tests/unit/ai/genre-section-validator.test.ts
git commit -m "feat(server): validate generic record declarations"
```

---

## Task 3: Generic Upsert for Record Items

**Files:**
- Modify: `packages/server/src/db/repositories/genre-sections.ts`
- Modify: `packages/server/src/ai/tools/genre-section-tools.ts`
- Test: `packages/server/tests/unit/db/repositories/genre-sections.test.ts`
- Test: `packages/server/tests/unit/ai/tools/genre-section-tools.test.ts`

- [ ] **Step 1: Write failing repo test for identity lookup**

Add a test that creates a section with `identityFields: ["代号"]`, inserts one item, and expects a new repo method to find it by identity key:

```ts
const section = repo.createSection({
  name: "任意集合",
  createdBy: "ai",
  identityFields: ["代号"],
  displayFields: ["名称"],
  schema: [
    { name: "代号", type: "string", role: "identity", required: true },
    { name: "名称", type: "string", role: "label" },
  ],
} as any);
const item = repo.addItem(section.id, { 代号: "A-1", 名称: "一号" });
expect(repo.findItemByIdentity(section, { 代号: "A-1" })?.id).toBe(item.id);
```

- [ ] **Step 2: Run repo test and verify RED**

Run:

```powershell
pnpm --filter @scribe/server test -- repositories/genre-sections.test.ts
```

Expected: FAIL because `findItemByIdentity` does not exist.

- [ ] **Step 3: Implement identity lookup in repo**

Add `identityFields` and metadata support to `NewGenreSectionInput`, persist them inside the existing JSON schema row for now by relying on `GenreSectionSchema.parse`, and add:

```ts
findItemByIdentity(
  section: GenreSection,
  data: Record<string, unknown>,
): GenreSectionItem | undefined {
  const incomingKey = resolveItemIdentityKey(section, data);
  if (!incomingKey) return undefined;
  return this.listItems(section.id).find((item) => resolveItemIdentityKey(section, item.data) === incomingKey);
}
```

Import `resolveItemIdentityKey` from `@scribe/shared`.

- [ ] **Step 4: Run repo test and verify GREEN**

Run:

```powershell
pnpm --filter @scribe/server test -- repositories/genre-sections.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing tool test for upsert**

Add a test:

```ts
it("upsert: same identity updates existing item instead of creating duplicate", async () => {
  await exec("create_genre_section", {
    name: "任意集合",
    identityFields: ["代号"],
    displayFields: ["名称"],
    schema: [
      { name: "代号", type: "string", required: true, role: "identity" },
      { name: "名称", type: "string", role: "label" },
      { name: "状态", type: "string", role: "status" },
    ],
  });
  const first = await exec("upsert_genre_section_item", {
    sectionName: "任意集合",
    data: { 代号: "A-1", 名称: "一号", 状态: "初始" },
  });
  const second = await exec("upsert_genre_section_item", {
    sectionName: "任意集合",
    data: { 代号: "A-1", 状态: "变化" },
  });
  const section = repo.getByName("任意集合");
  expect(repo.listItems(section.id)).toHaveLength(1);
  expect(second.updated).toBeTruthy();
  expect(repo.getItem(first.item.id).data).toMatchObject({ 代号: "A-1", 名称: "一号", 状态: "变化" });
});
```

- [ ] **Step 6: Run tool test and verify RED**

Run:

```powershell
pnpm --filter @scribe/server test -- ai/tools/genre-section-tools.test.ts
```

Expected: FAIL because `upsert_genre_section_item` does not exist or `create_genre_section` does not accept identity metadata.

- [ ] **Step 7: Implement upsert tool and preserve old wrapper**

Update `create_genre_section` parameters to accept `identityFields`, `displayFields`, and `searchFields`. Validate declarations before create.

Add `upsert_genre_section_item`:

```ts
upsert_genre_section_item: tool({
  description: "通用写入记录条目。按板块声明的 identityFields 查重;存在则 merge 更新,不存在才新增。本地负责去重,AI 不需要先查。",
  parameters: z.object({
    sectionName: z.string(),
    data: z.record(z.unknown()),
  }),
  execute: async ({ sectionName, data }) => {
    const section = repo.getByName(sectionName);
    if (!section) throw new Error(`板块不存在:${sectionName}`);
    validateSectionDeclaration(section);
    validateItemAgainstSchema(section, data, deps.charactersRepo, repo);
    const existing = repo.findItemByIdentity?.(section, data);
    if (existing) {
      const merged = { ...existing.data, ...data };
      validateItemAgainstSchema(section, merged, deps.charactersRepo, repo);
      const updated = repo.updateItem(existing.id, merged);
      return { updated: true, item: updated };
    }
    const item = repo.addItem(section.id, data);
    return { created: true, item };
  },
})
```

Change `add_genre_section_item` to call the same implementation and return a deprecation-compatible result, so old prompts/tests can be migrated gradually.

- [ ] **Step 8: Run tool tests and verify GREEN**

Run:

```powershell
pnpm --filter @scribe/server test -- ai/tools/genre-section-tools.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```powershell
git add packages/server/src/db/repositories/genre-sections.ts packages/server/src/ai/tools/genre-section-tools.ts packages/server/tests/unit/db/repositories/genre-sections.test.ts packages/server/tests/unit/ai/tools/genre-section-tools.test.ts
git commit -m "feat(server): upsert generic record items by identity"
```

---

## Task 4: Prompt Rewrite to Remove Topic-Specific Local Logic

**Files:**
- Modify: `packages/server/src/ai/prompts/new-book-onboard.ts`
- Modify: `packages/server/src/ai/orchestrator/record-state.ts`
- Test: `packages/server/tests/integration/new-book-flow.test.ts`
- Test: `packages/server/tests/integration/genre-section-conversation.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Add assertions that prompt text does not rely on topic lists as required behavior and does include generic modeling rules:

```ts
expect(NEW_BOOK_ONBOARD_PROMPT).toContain("长期保持一致");
expect(NEW_BOOK_ONBOARD_PROMPT).toContain("create_genre_section");
expect(NEW_BOOK_ONBOARD_PROMPT).toContain("identityFields");
expect(NEW_BOOK_ONBOARD_PROMPT).toContain("displayFields");
expect(NEW_BOOK_ONBOARD_PROMPT).not.toContain("修仙/玄幻 →");
expect(NEW_BOOK_ONBOARD_PROMPT).not.toContain("都市/异能 →");
```

For `RECORD_STATE_PROMPT`, assert:

```ts
expect(RECORD_STATE_PROMPT).toContain("upsert_genre_section_item");
expect(RECORD_STATE_PROMPT).toContain("如果已有集合不能表达新信息");
expect(RECORD_STATE_PROMPT).toContain("本地工具会按 identityFields 去重");
expect(RECORD_STATE_PROMPT).not.toContain("功法、法器、丹药、势力、境界、异能");
```

- [ ] **Step 2: Run prompt-related tests and verify RED**

Run:

```powershell
pnpm --filter @scribe/server test -- new-book-flow.test.ts genre-section-conversation.test.ts
```

Expected: FAIL due to old topic-list text and missing new constraints.

- [ ] **Step 3: Rewrite onboarding prompt**

Replace the topic-list section with generic instructions:

```ts
识别到题材、世界观、人物关系或核心冲突后,立即判断这本书有哪些"需要长期保持一致的记录对象"。
这些对象类别由你根据用户输入自动决定,不要套用固定清单。

当需要长期追踪一类对象时,调用 create_genre_section 创建通用记录集合:
- name: 用作者能看懂的集合名
- identityFields: 能唯一识别同一条记录的字段
- displayFields: 展示给作者看的字段
- searchFields: 后续召回可检索的字段
- schema: 字段数组。每个字段都要声明通用 role,如 identity/label/summary/description/status/rank/relation/tag/evidence

如果后续发现字段不够,用 update_genre_section_schema 扩展集合,不要新建重复集合。
本地系统只理解通用字段声明,不理解任何具体题材名词;题材判断全部由你完成。
```

- [ ] **Step 4: Rewrite record-state prompt**

Change the record item instruction to:

```ts
4. **通用记录集合**:
   - 本章出现了需要长期保持一致的新对象/规则/资源/关系/线索时,先判断现有集合是否能表达。
   - 能表达:调用 upsert_genre_section_item 写入或更新条目。
   - 不能表达:先 create_genre_section 或 update_genre_section_schema,再 upsert_genre_section_item。
   - 本地工具会按 identityFields 去重,不要为了同一对象重复创建条目。
```

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```powershell
pnpm --filter @scribe/server test -- new-book-flow.test.ts genre-section-conversation.test.ts
```

Expected: PASS after updating expected tool names and prompt assertions.

- [ ] **Step 6: Commit Task 4**

```powershell
git add packages/server/src/ai/prompts/new-book-onboard.ts packages/server/src/ai/orchestrator/record-state.ts packages/server/tests/integration/new-book-flow.test.ts packages/server/tests/integration/genre-section-conversation.test.ts
git commit -m "feat(ai): prompt generic record modeling"
```

---

## Task 5: Declaration-Aware Archive Summary and Static Context

**Files:**
- Modify: `packages/server/src/ai/orchestrator/record-state.ts`
- Modify: `packages/server/src/ai/context-builder/builder.ts`
- Test: `packages/server/tests/unit/ai/orchestrator/record-state.test.ts` if present, otherwise create this file.
- Test: `packages/server/tests/integration/context-builder.test.ts`

- [ ] **Step 1: Write failing archive summary test**

Create or extend a test that expects archive summary to include declared identity/display/search fields and item search text:

```ts
const summary = buildArchiveSummary({
  genreSections: [{
    section: {
      name: "任意集合",
      identityFields: ["代号"],
      displayFields: ["名称"],
      searchFields: ["代号", "名称", "摘要"],
      schema: [
        { name: "代号", type: "string", role: "identity", required: true },
        { name: "名称", type: "string", role: "label" },
        { name: "摘要", type: "text", role: "summary" },
      ],
    },
    items: [{ data: { 代号: "A-1", 名称: "一号", 摘要: "重要可检索信息" } }],
  }],
  characters: [],
  activeForeshadowing: [],
});
expect(summary).toContain("identity:代号");
expect(summary).toContain("display:名称");
expect(summary).toContain("A-1");
expect(summary).toContain("重要可检索信息");
```

- [ ] **Step 2: Run archive/context tests and verify RED**

Run:

```powershell
pnpm --filter @scribe/server test -- record-state.test.ts context-builder.test.ts
```

Expected: FAIL because archive summary does not render these declarations.

- [ ] **Step 3: Implement declaration-aware rendering**

Use `resolveItemLabel`, `resolveItemSearchText`, `resolveIdentityFieldNames`, and `resolveDisplayFieldNames` to render:

```text
- 集合名(identity:字段; display:字段; search:字段)
  schema: 字段名(role,type,required)
  existing:
  - label | identityKey | search text
```

In `renderStaticBlock`, stop dumping raw JSON only. Render compact declared text first, and keep JSON only as fallback for fields not covered by search text.

- [ ] **Step 4: Run archive/context tests and verify GREEN**

Run:

```powershell
pnpm --filter @scribe/server test -- record-state.test.ts context-builder.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```powershell
git add packages/server/src/ai/orchestrator/record-state.ts packages/server/src/ai/context-builder/builder.ts packages/server/tests/unit/ai/orchestrator/record-state.test.ts packages/server/tests/integration/context-builder.test.ts
git commit -m "feat(context): render generic records from declarations"
```

---

## Task 6: Generic Records Participate in Recall

**Files:**
- Modify: `packages/server/src/ai/context-builder/recall.ts`
- Modify: `packages/server/src/ai/context-builder/book-context.ts`
- Test: `packages/server/tests/unit/ai/context-builder/book-context.test.ts`
- Test: add or extend `packages/server/tests/unit/ai/context-builder/recall.test.ts`

- [ ] **Step 1: Write failing recall tests**

Add test input:

```ts
const recalled = recallChapters({
  allSummaries: [
    {
      chapterNo: 1,
      oneLiner: "A-1 首次出现",
      paragraph: "这里记录了 A-1 的早期线索。",
      keyEvents: [{ event: "A-1 出现", characters: [], foreshadowingRefs: [] }],
      generatedAt: 1,
      reasoningContent: null,
    },
    {
      chapterNo: 2,
      oneLiner: "无关章节",
      paragraph: "没有相关内容。",
      keyEvents: [{ event: "无关", characters: [], foreshadowingRefs: [] }],
      generatedAt: 1,
      reasoningContent: null,
    },
  ],
  currentChapterNo: 6,
  intentCharacters: [],
  intentForeshadowing: [],
  intentRecords: ["A-1"],
});
expect(recalled.map((s) => s.chapterNo)).toEqual([1]);
```

- [ ] **Step 2: Run recall tests and verify RED**

Run:

```powershell
pnpm --filter @scribe/server test -- recall.test.ts book-context.test.ts
```

Expected: FAIL because `intentRecords` does not exist.

- [ ] **Step 3: Add record intent scoring**

Extend `RecallInput`:

```ts
intentRecords?: string[];
```

Score record terms by substring match:

```ts
const rs = (input.intentRecords ?? []).filter((r) => r && r.trim());
for (const r of rs) if (text.includes(r)) score += 4;
```

In `deriveRecallIntent`, collect record labels/search terms from `snapshot.genreSections` when they appear in latest summary text or user intent.

- [ ] **Step 4: Run recall tests and verify GREEN**

Run:

```powershell
pnpm --filter @scribe/server test -- recall.test.ts book-context.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```powershell
git add packages/server/src/ai/context-builder/recall.ts packages/server/src/ai/context-builder/book-context.ts packages/server/tests/unit/ai/context-builder/recall.test.ts packages/server/tests/unit/ai/context-builder/book-context.test.ts
git commit -m "feat(recall): include generic record entities"
```

---

## Task 7: Client Rendering from Generic Declarations

**Files:**
- Modify: `packages/client/src/components/sidebar/genre-section-panel.tsx`
- Test: `packages/client/tests/components/genre-section-panel.test.tsx`

- [ ] **Step 1: Write failing client test**

Add a test fixture with:

```ts
schema: [
  { name: "代号", type: "string", role: "identity", required: true },
  { name: "名称", type: "string", role: "label" },
  { name: "摘要", type: "text", role: "summary" },
],
identityFields: ["代号"],
displayFields: ["名称"],
items: [{ id: "i1", sectionId: "s1", data: { 代号: "A-1", 名称: "一号", 摘要: "说明" } }]
```

Expect the panel to show `一号`, not `(未命名)`, and to show non-display fields below it.

- [ ] **Step 2: Run client test and verify RED**

Run:

```powershell
pnpm --filter @scribe/client test -- genre-section-panel.test.tsx
```

Expected: FAIL if local component interfaces do not include metadata or resolver calls are incompatible.

- [ ] **Step 3: Update component interfaces and rendering**

Extend the local `GenreSection` interface:

```ts
identityFields?: string[];
displayFields?: string[];
searchFields?: string[];
```

Pass the full section object to shared resolvers. Filter display fields with `resolveDisplayFieldNames(section)` instead of only one label field.

- [ ] **Step 4: Run client test and verify GREEN**

Run:

```powershell
pnpm --filter @scribe/client test -- genre-section-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```powershell
git add packages/client/src/components/sidebar/genre-section-panel.tsx packages/client/tests/components/genre-section-panel.test.tsx
git commit -m "feat(client): render generic record declarations"
```

---

## Task 8: Generic Record Relation Interface

**Files:**
- Modify: `packages/server/src/ai/tools/genre-section-tools.ts`
- Modify: `packages/server/src/db/repositories/genre-sections.ts` only if a small helper makes relation updates clearer.
- Test: `packages/server/tests/unit/ai/tools/genre-section-tools.test.ts`
- Test: `packages/server/tests/unit/db/repositories/genre-sections.test.ts` only if repository helpers are added.

- [ ] **Step 1: Write failing tool test for relation linking**

Add a test with two generic collections. The source collection has a relation field whose type references the target collection and whose role is `relation`:

```ts
it("links two generic record items through a declared relation field", async () => {
  await exec("create_genre_section", {
    name: "Source Records",
    identityFields: ["code"],
    displayFields: ["title"],
    searchFields: ["code", "title"],
    schema: [
      { name: "code", type: "string", required: true, role: "identity" },
      { name: "title", type: "string", role: "label" },
      { name: "relatedTargets", type: "list:ref:section:Target Records", role: "relation" },
    ],
  });
  await exec("create_genre_section", {
    name: "Target Records",
    identityFields: ["code"],
    displayFields: ["title"],
    searchFields: ["code", "title"],
    schema: [
      { name: "code", type: "string", required: true, role: "identity" },
      { name: "title", type: "string", role: "label" },
    ],
  });
  await exec("upsert_genre_section_item", {
    sectionName: "Source Records",
    data: { code: "S-1", title: "Source One" },
  });
  await exec("upsert_genre_section_item", {
    sectionName: "Target Records",
    data: { code: "T-1", title: "Target One" },
  });

  const result = await exec("link_record_items", {
    sourceSectionName: "Source Records",
    sourceIdentity: { code: "S-1" },
    relationField: "relatedTargets",
    targetSectionName: "Target Records",
    targetIdentity: { code: "T-1" },
  });

  expect(result.linked).toBe(true);
  const source = repo.findItemByIdentity(repo.getByName("Source Records")!, { code: "S-1" })!;
  expect(source.data.relatedTargets).toEqual([result.targetItemId]);
});
```

- [ ] **Step 2: Run relation tool test and verify RED**

Run:

```powershell
pnpm --filter @scribe/server test -- ai/tools/genre-section-tools.test.ts
```

Expected: FAIL because `link_record_items` does not exist.

- [ ] **Step 3: Implement `link_record_items` as a generic relation primitive**

Add a tool that accepts only generic identifiers:

```ts
link_record_items: tool({
  description: "通用记录关系链接。按 source/target 集合声明的 identityFields 定位两端记录,再写入 source 记录中声明为 relation 的字段。本地只校验声明和引用,不理解任何题材语义。",
  parameters: z.object({
    sourceSectionName: z.string(),
    sourceIdentity: z.record(z.unknown()),
    relationField: z.string(),
    targetSectionName: z.string(),
    targetIdentity: z.record(z.unknown()),
  }),
  execute: async (input) => {
    const sourceSection = repo.getByName(input.sourceSectionName);
    const targetSection = repo.getByName(input.targetSectionName);
    if (!sourceSection || !targetSection) throw new Error("record collection not found");
    validateSectionDeclaration(sourceSection);
    validateSectionDeclaration(targetSection);

    const relationField = sourceSection.schema.find((field) => field.name === input.relationField);
    if (!relationField || relationField.role !== "relation") {
      throw new Error(`relation field ${input.relationField} is not declared`);
    }
    if (relationField.type !== `ref:section:${targetSection.name}` && relationField.type !== `list:ref:section:${targetSection.name}`) {
      throw new Error(`relation field ${input.relationField} does not reference ${targetSection.name}`);
    }

    const sourceItem = repo.findItemByIdentity(sourceSection, input.sourceIdentity);
    const targetItem = repo.findItemByIdentity(targetSection, input.targetIdentity);
    if (!sourceItem || !targetItem) throw new Error("record item not found");

    const existing = sourceItem.data[input.relationField];
    const nextValue = relationField.type.startsWith("list:")
      ? Array.from(new Set([...(Array.isArray(existing) ? existing : []), targetItem.id]))
      : targetItem.id;
    const updated = repo.updateItem(sourceItem.id, { ...sourceItem.data, [input.relationField]: nextValue });
    return { linked: true, sourceItemId: updated.id, targetItemId: targetItem.id, relationField: input.relationField };
  },
})
```

Keep the relation payload generic. Do not add concepts like parent/ally/enemy/source/owner unless they are just user-declared field names inside the schema.

- [ ] **Step 4: Add relation prompt guidance**

In `packages/server/src/ai/orchestrator/record-state.ts`, add one generic instruction:

```text
当两个通用记录条目之间出现长期关系时,优先使用 schema 中 role=relation 的字段并调用 link_record_items。若没有合适 relation 字段,先 update_record_collection_schema 添加通用 relation 字段,再 link。不要把关系含义写成本地逻辑;关系语义只存在于集合名、字段名和 AI 写入的数据里。
```

- [ ] **Step 5: Run relation tests and server prompt tests**

Run:

```powershell
pnpm --filter @scribe/server test -- ai/tools/genre-section-tools.test.ts genre-section-conversation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

```powershell
git add packages/server/src/ai/tools/genre-section-tools.ts packages/server/src/ai/orchestrator/record-state.ts packages/server/tests/unit/ai/tools/genre-section-tools.test.ts packages/server/tests/integration/genre-section-conversation.test.ts
git commit -m "feat(server): link generic record relations"
```

---

## Task 9: Compatibility and Naming Cleanup

**Files:**
- Modify: exported names in `packages/shared/src/index.ts` if needed.
- Modify: tool registry and callers under `packages/server/src/ai/tools/registry.ts`, `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`, and route code if naming changes.
- Test: impacted server/shared/client tests.

- [ ] **Step 1: Decide compatibility boundary**

Keep database table names `genre_sections` and `genre_section_items` for this iteration to avoid a risky migration. Treat them as storage names only. Public AI/tool/prompt language should say "通用记录集合" and "record collection".

- [ ] **Step 2: Add compatibility aliases**

If needed, export aliases:

```ts
export type RecordCollection = GenreSection;
export type RecordItem = GenreSectionItem;
export type RecordField = GenreField;
```

Do not rename every file in this task. That can be a later mechanical cleanup after behavior stabilizes.

- [ ] **Step 3: Run package tests**

Run:

```powershell
pnpm --filter @scribe/shared test
pnpm --filter @scribe/server test
pnpm --filter @scribe/client test
```

Expected: all pass.

- [ ] **Step 4: Commit Task 9**

```powershell
git add packages/shared/src/index.ts packages/server/src/ai/tools/registry.ts packages/server/src/ai/orchestrator/conversation-orchestrator.ts
git commit -m "chore: expose generic record compatibility names"
```

---

## Task 10: Full Verification

**Files:**
- No production files unless verification reveals failures.

- [ ] **Step 1: Run shared tests**

```powershell
pnpm --filter @scribe/shared test
```

Expected: all shared tests pass.

- [ ] **Step 2: Run server tests**

```powershell
pnpm --filter @scribe/server test
```

Expected: all server tests pass.

- [ ] **Step 3: Run client tests**

```powershell
pnpm --filter @scribe/client test
```

Expected: all client tests pass.

- [ ] **Step 4: Run typecheck**

```powershell
pnpm -r exec tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 5: Optional E2E**

If no dev server is occupying port `6789`, run:

```powershell
pnpm --filter scribe-e2e test
```

Expected: E2E tests pass. If port conflict blocks this, record the conflict and the exact skipped command.

- [ ] **Step 6: Manual code audit for prohibited specialization**

Run:

```powershell
rg -n "功法|法器|丹药|势力|境界|异能|修仙|玄幻|都市/异能|财务|人脉" packages/server/src packages/shared/src packages/client/src
```

Expected: no production logic branches or required prompt lists using these as local rules. Occurrences in tests, user-facing examples, or historical compatibility comments must be reviewed individually.

- [ ] **Step 7: Final commit**

```powershell
git status --short
git add packages docs
git commit -m "feat: make topic records generic and declaration-driven"
```

---

## Self-Review Checklist

- Spec coverage: The plan covers shared schema, validation, tool write path, prompts, archive summary, static context, recall, client rendering, compatibility, and verification.
- Placeholder scan: No task uses unresolved "TBD" or "implement later" language.
- Type consistency: The plan consistently uses `identityFields`, `displayFields`, `searchFields`, `role`, `upsert_genre_section_item`, and legacy `GenreSection` storage names.
- Scope check: The plan intentionally avoids renaming database tables in the same pass; this keeps the behavior change testable without a large storage migration.
