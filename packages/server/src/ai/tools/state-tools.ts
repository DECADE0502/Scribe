import { tool, type Tool } from "ai";
import { z } from "zod";

export interface StateCharactersRepoLike {
  list(): Array<{
    id: string;
    name: string;
    currentState: Record<string, unknown>;
    appearances?: Array<{ chapterNo: number; brief: string }>;
  }>;
  update(id: string, patch: Record<string, unknown>): unknown;
  addAppearance(id: string, appearance: { chapterNo: number; brief: string }): unknown;
  create(input: {
    name: string;
    role: "protagonist" | "antagonist" | "supporting";
    baseData: Record<string, unknown>;
    currentState: Record<string, unknown>;
  }): { id: string; name: string };
}

export interface StateForeshadowingRepoLike {
  list(filterStatus?: "active" | "paid" | "dropped"): Array<{ id: string; label: string }>;
  create(input: {
    label: string;
    description: string | null;
    plantedChapter: number | null;
    paidChapter: number | null;
    status: "active" | "paid" | "dropped";
    relatedCharacters: string[];
  }): unknown;
  pay(id: string, paidChapter: number): unknown;
}

export interface StateTimelineRepoLike {
  listByChapter?(chapterNo: number): Array<{
    chapterNo: number;
    storyTime: string;
    event: string;
    participants: string[];
  }>;
  listAll?(): Array<{
    chapterNo: number;
    storyTime: string;
    event: string;
    participants: string[];
  }>;
  create(input: {
    chapterNo: number;
    storyTime: string;
    event: string;
    participants: string[];
  }): unknown;
}

export interface StateToolsDeps {
  charactersRepo: StateCharactersRepoLike;
  foreshadowingRepo: StateForeshadowingRepoLike;
  timelineRepo: StateTimelineRepoLike;
  chapterNo: number;
}

const stateRecordSchema = z.union([z.record(z.unknown()), z.string()]);

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function sameStringSet(left: string[], right: string[]): boolean {
  const normalize = (values: string[]) => [...new Set(values.map(normalizeText))].sort();
  const a = normalize(left);
  const b = normalize(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function findCharacter(deps: StateToolsDeps, name: string) {
  const normalizedName = normalizeText(name);
  const c = deps.charactersRepo.list().find(x => normalizeText(x.name) === normalizedName);
  if (!c) throw new Error(`角色不存在: ${name} (create it first)`);
  return c;
}

function parseStateRecord(value: z.infer<typeof stateRecordSchema>): Record<string, unknown> {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  throw new Error("state must be an object or a JSON object string");
}

export function makeStateTools(deps: StateToolsDeps): Record<string, Tool> {
  return {
    create_character: tool({
      description: "Create a character that appears in this chapter and is not already in the character list.",
      parameters: z.object({
        name: z.string().describe("Character name"),
        role: z.enum(["protagonist", "antagonist", "supporting"]).describe("Character role"),
        background: z.string().optional().describe("One-sentence background or identity"),
        motivation: z.string().optional().describe("Known motivation or goal"),
        languageHabits: z.string().optional().describe("Known speech or behavior habits"),
      }),
      execute: async ({ name, role, background, motivation, languageHabits }) => {
        const cleanName = normalizeText(name);
        const existing = deps.charactersRepo.list().find(x => normalizeText(x.name) === cleanName);
        if (existing) return { skipped: "character already exists", name: cleanName };
        const baseData: Record<string, unknown> = {};
        if (background) baseData.background = normalizeText(background);
        if (motivation) baseData.motivation = normalizeText(motivation);
        if (languageHabits) baseData.languageHabits = normalizeText(languageHabits);
        const c = deps.charactersRepo.create({ name: cleanName, role, baseData, currentState: {} });
        return { created: c.name, role };
      },
    }),

    update_character_state: tool({
      description: "Merge chapter-end character state changes into the existing current state.",
      parameters: z.object({
        name: z.string().describe("Character name"),
        state: stateRecordSchema.describe("State object, or a JSON object string if needed"),
      }),
      execute: async ({ name, state }) => {
        const c = findCharacter(deps, name);
        const parsedState = parseStateRecord(state);
        const merged = { ...c.currentState, ...parsedState };
        deps.charactersRepo.update(c.id, { currentState: merged });
        return { updated: c.name, state: merged };
      },
    }),

    add_character_appearance: tool({
      description: "Record one concise appearance summary for a character in the current chapter.",
      parameters: z.object({
        name: z.string().describe("Character name"),
        brief: z.string().describe("One-sentence summary of the character's role in this chapter"),
      }),
      execute: async ({ name, brief }) => {
        const c = findCharacter(deps, name);
        if (c.appearances?.some(appearance => appearance.chapterNo === deps.chapterNo)) {
          return { skipped: "appearance already recorded for this chapter", name: c.name, chapterNo: deps.chapterNo };
        }
        deps.charactersRepo.addAppearance(c.id, { chapterNo: deps.chapterNo, brief: normalizeText(brief) });
        return { recorded: c.name, chapterNo: deps.chapterNo };
      },
    }),

    add_foreshadowing: tool({
      description: "Register a newly planted foreshadowing item for the current chapter.",
      parameters: z.object({
        label: z.string().describe("Short label"),
        description: z.string().optional().describe("Foreshadowing description"),
        relatedCharacters: z.array(z.string()).optional().describe("Related character names"),
      }),
      execute: async ({ label, description, relatedCharacters }) => {
        const cleanLabel = normalizeText(label);
        const existing = deps.foreshadowingRepo.list().find(f => normalizeText(f.label) === cleanLabel);
        if (existing) return { skipped: "foreshadowing already exists", label: cleanLabel };
        deps.foreshadowingRepo.create({
          label: cleanLabel,
          description: description ? normalizeText(description) : null,
          plantedChapter: deps.chapterNo,
          paidChapter: null,
          status: "active",
          relatedCharacters: relatedCharacters?.map(normalizeText) ?? [],
        });
        return { planted: cleanLabel, chapterNo: deps.chapterNo };
      },
    }),

    pay_foreshadowing: tool({
      description: "Mark an active foreshadowing item as paid off in the current chapter.",
      parameters: z.object({
        label: z.string().describe("Existing foreshadowing label"),
      }),
      execute: async ({ label }) => {
        const cleanLabel = normalizeText(label);
        const f = deps.foreshadowingRepo.list("active").find(x => normalizeText(x.label) === cleanLabel);
        if (!f) throw new Error(`active foreshadowing not found: ${label}`);
        deps.foreshadowingRepo.pay(f.id, deps.chapterNo);
        return { paid: f.label, chapterNo: deps.chapterNo };
      },
    }),

    add_timeline_event: tool({
      description: "Record a key timeline event for the current chapter.",
      parameters: z.object({
        storyTime: z.string().describe("In-story time"),
        event: z.string().describe("One-sentence event"),
        participants: z.array(z.string()).optional().describe("Participant character names"),
      }),
      execute: async ({ storyTime, event, participants }) => {
        const cleanStoryTime = normalizeText(storyTime);
        const cleanEvent = normalizeText(event);
        const cleanParticipants = participants?.map(normalizeText) ?? [];
        const existingEvents = deps.timelineRepo.listByChapter?.(deps.chapterNo)
          ?? deps.timelineRepo.listAll?.().filter(item => item.chapterNo === deps.chapterNo)
          ?? [];
        const existing = existingEvents.find(item =>
          normalizeText(item.storyTime) === cleanStoryTime &&
          normalizeText(item.event) === cleanEvent &&
          sameStringSet(item.participants, cleanParticipants)
        );
        if (existing) return { skipped: "timeline event already recorded for this chapter", event: cleanEvent };
        deps.timelineRepo.create({
          chapterNo: deps.chapterNo,
          storyTime: cleanStoryTime,
          event: cleanEvent,
          participants: cleanParticipants,
        });
        return { recorded: cleanEvent };
      },
    }),
  };
}
