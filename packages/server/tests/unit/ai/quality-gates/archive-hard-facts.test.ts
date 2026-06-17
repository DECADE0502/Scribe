import { describe, expect, it } from "vitest";
import { extractArchiveHardFacts } from "../../../../src/ai/quality-gates/archive-hard-facts.js";

describe("extractArchiveHardFacts", () => {
  it("extracts character current state as hard facts", () => {
    const facts = extractArchiveHardFacts({
      characters: [{ name: "Lin Chen", currentState: { location: "east gate", realm: "Qi Refining 3" } }],
      timelineEvents: [],
      genericRecords: [],
    });

    expect(facts).toContainEqual(expect.objectContaining({
      entity: "Lin Chen",
      attribute: "location",
      value: "east gate",
      source: "character_state",
    }));
    expect(facts).toContainEqual(expect.objectContaining({
      entity: "Lin Chen",
      attribute: "realm",
      value: "Qi Refining 3",
    }));
  });

  it("extracts generic record fields with identity and evidence", () => {
    const facts = extractArchiveHardFacts({
      characters: [],
      timelineEvents: [],
      genericRecords: [{
        collectionName: "Ship State",
        identity: "ship",
        data: { fuel: { quantity: 18, unit: "percent" }, location: "Europa orbit" },
      }],
    });

    expect(facts).toContainEqual(expect.objectContaining({
      entity: "ship",
      attribute: "fuel",
      value: { quantity: 18, unit: "percent" },
      source: "generic_record",
    }));
    expect(facts).toContainEqual(expect.objectContaining({
      entity: "ship",
      attribute: "location",
      value: "Europa orbit",
    }));
  });

  it("extracts timeline events as evidence facts without inventing attributes", () => {
    const facts = extractArchiveHardFacts({
      characters: [],
      timelineEvents: [{ chapterNo: 4, storyTime: "23:10", event: "The knife was locked in the drawer.", participants: ["Detective"] }],
      genericRecords: [],
    });

    expect(facts).toContainEqual(expect.objectContaining({
      entity: "timeline",
      attribute: "event",
      value: "The knife was locked in the drawer.",
      source: "timeline",
      chapterNo: 4,
    }));
  });
});
