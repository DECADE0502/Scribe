import {
  resolveDisplayFieldNames,
  resolveIdentityFieldNames,
  resolveItemIdentityKey,
  resolveItemLabel,
  resolveItemSearchText,
  type GenreFieldRole,
} from "@scribe/shared";

export const RECORD_STATE_PROMPT = `你是 Scribe 的设定记录员。刚写完一章,你的任务是把本章新出现/变化的信息记录进结构化档案,供后续章节保持一致性。

你将收到:本章正文、当前已记录的档案概要(通用记录集合/角色/伏笔)。

请按需调用工具,逐项记录:
1. 通用记录集合:
   - 本章出现了需要长期保持一致的新对象、规则、资源、关系、线索或状态时,先判断现有集合是否能表达。
   - 能表达:调用 upsert_record_item 写入或更新条目。
   - 如果已有集合不能表达新信息,先 create_record_collection 或 update_record_collection_schema,再 upsert_record_item。
   - create_record_collection 时必须声明 identityFields/displayFields/searchFields;字段只使用通用 role(identity/label/summary/description/status/rank/relation/tag/evidence)。
   - 本地工具会按 identityFields 去重,不要为了同一对象重复创建条目。
   - 当两个通用记录条目之间出现长期关系时,优先使用 schema 中 role=relation 的字段并调用 link_record_items。若没有合适 relation 字段,先 update_record_collection_schema 添加通用 relation 字段,再 link。
2. 只记录本章确实出现的内容,不要脑补未出现的设定。
3. 更新优先于新建,全部记录完成后输出一行中文总结。`;

export interface ArchiveSummarySources {
  genreSections: Array<{
    section: {
      name: string;
      identityFields?: string[];
      displayFields?: string[];
      searchFields?: string[];
      schema: Array<{
        name: string;
        type: unknown;
        required?: boolean;
        role?: GenreFieldRole;
        isLabel?: boolean;
      }>;
    };
    items: Array<{ data: Record<string, unknown> }>;
  }>;
  characters: Array<{ name: string; currentState: Record<string, unknown> }>;
  activeForeshadowing: Array<{ label: string }>;
}

export function buildArchiveSummary(src: ArchiveSummarySources): string {
  const parts: string[] = [];
  parts.push("### 通用记录集合(schema 与已有条目)");
  for (const { section, items } of src.genreSections) {
    const schemaDesc = section.schema
      .map(f => `${f.name}${f.required ? "*" : ""}:${typeof f.type === "string" ? f.type : "enum"}${f.role ? `(${f.role})` : ""}`)
      .join(", ");
    const identity = resolveIdentityFieldNames(section).join(",") || "(未声明)";
    const display = resolveDisplayFieldNames(section).join(",") || "(未声明)";
    const search = section.searchFields?.join(",") || "(未声明)";
    parts.push(
      `- ${section.name}(identity:${identity}; display:${display}; search:${search}; 字段:${schemaDesc})`,
    );
    if (!items.length) {
      parts.push("  已有:(空)");
    } else {
      parts.push("  已有:");
      for (const item of items) {
        const label = resolveItemLabel(section, item.data, "?");
        const identityKey = resolveItemIdentityKey(section, item.data) ?? "?";
        const searchText = resolveItemSearchText(section, item.data);
        parts.push(`  - ${label} | ${identityKey}${searchText ? ` | ${searchText}` : ""}`);
      }
    }
  }
  parts.push("### 角色与当前状态");
  for (const c of src.characters) {
    parts.push(`- ${c.name}:${JSON.stringify(c.currentState)}`);
  }
  parts.push("### 活跃伏笔");
  parts.push(src.activeForeshadowing.map(f => f.label).join("、") || "(无)");
  return parts.join("\n");
}
