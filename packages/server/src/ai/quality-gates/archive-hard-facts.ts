import type { HardFactClaim, HardFactValue } from "./hard-facts.js";

export interface ArchiveHardFactSources {
  characters: Array<{ name: string; currentState: Record<string, unknown> }>;
  timelineEvents: Array<{ chapterNo: number; storyTime: string | null; event: string; participants: string[] }>;
  genericRecords: Array<{ collectionName: string; identity: string; data: Record<string, unknown> }>;
}

function isFactValue(value: unknown): value is HardFactValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (typeof value === "object" && value !== null && "quantity" in value) {
    const maybe = value as { quantity?: unknown; unit?: unknown; raw?: unknown };
    return typeof maybe.quantity === "number" &&
      (maybe.unit === undefined || typeof maybe.unit === "string") &&
      (maybe.raw === undefined || typeof maybe.raw === "string");
  }
  return false;
}

function coerceFactValue(value: unknown): HardFactValue | undefined {
  if (isFactValue(value)) return value;
  if (Array.isArray(value)) return value.length ? value.join(", ") : undefined;
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return undefined;
}

function inferFactType(attribute: string, value: HardFactValue): HardFactClaim["factType"] {
  const lower = attribute.toLowerCase();
  if (typeof value === "object" && value !== null && "quantity" in value) return "quantity";
  if (["location", "position", "where", "地点", "位置"].some((term) => lower.includes(term.toLowerCase()))) return "location";
  if (["owner", "holder", "belong", "归属", "持有者"].some((term) => lower.includes(term.toLowerCase()))) return "ownership";
  if (["deadline", "timer", "cooldown", "倒计时", "期限", "冷却"].some((term) => lower.includes(term.toLowerCase()))) return "deadline";
  if (["injury", "wound", "伤", "伤势"].some((term) => lower.includes(term.toLowerCase()))) return "injury";
  if (["relation", "relationship", "关系", "契约"].some((term) => lower.includes(term.toLowerCase()))) return "relationship";
  return "state";
}

export function extractArchiveHardFacts(src: ArchiveHardFactSources): HardFactClaim[] {
  const facts: HardFactClaim[] = [];

  for (const character of src.characters) {
    for (const [attribute, rawValue] of Object.entries(character.currentState ?? {})) {
      const value = coerceFactValue(rawValue);
      if (value === undefined) continue;
      facts.push({
        entity: character.name,
        attribute,
        value,
        factType: inferFactType(attribute, value),
        scope: "character",
        source: "character_state",
        evidence: `${character.name}.${attribute}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
        confidence: 1,
      });
    }
  }

  for (const record of src.genericRecords) {
    for (const [attribute, rawValue] of Object.entries(record.data ?? {})) {
      const value = coerceFactValue(rawValue);
      if (value === undefined) continue;
      facts.push({
        entity: record.identity,
        attribute,
        value,
        factType: inferFactType(attribute, value),
        scope: "book",
        source: "generic_record",
        evidence: `${record.collectionName}:${record.identity}.${attribute}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
        confidence: 1,
      });
    }
  }

  for (const event of src.timelineEvents) {
    facts.push({
      entity: "timeline",
      attribute: "event",
      value: event.event,
      factType: "state",
      scope: "book",
      source: "timeline",
      evidence: event.storyTime ? `${event.storyTime}: ${event.event}` : event.event,
      confidence: 0.7,
      chapterNo: event.chapterNo,
    });
  }

  return facts;
}
