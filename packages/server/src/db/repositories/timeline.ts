import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import {
  type TimelineEvent,
  type NewTimelineEvent,
  TimelineEventSchema,
} from "@scribe/shared";
import { parseJsonArray } from "../json-utils.js";

export function createTimelineRepo(db: Database) {
  const rowToEvent = (r: any): TimelineEvent =>
    TimelineEventSchema.parse({
      id: r.id,
      chapterNo: r.chapter_no,
      storyTime: r.story_time,
      event: r.event,
      participants: parseJsonArray<string>(r.participants),
    });

  return {
    create(input: NewTimelineEvent): TimelineEvent {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO timeline_events(id,chapter_no,story_time,event,participants)
                  VALUES(?,?,?,?,?)`
      ).run(
        id,
        input.chapterNo,
        input.storyTime,
        input.event,
        JSON.stringify(input.participants)
      );
      return this.get(id)!;
    },
    get(id: string): TimelineEvent | undefined {
      const r = db.prepare("SELECT * FROM timeline_events WHERE id=?").get(id);
      return r ? rowToEvent(r) : undefined;
    },
    listByChapter(chapterNo: number): TimelineEvent[] {
      return db
        .prepare(
          "SELECT * FROM timeline_events WHERE chapter_no=? ORDER BY story_time ASC"
        )
        .all(chapterNo)
        .map(rowToEvent);
    },
    listAll(): TimelineEvent[] {
      return db
        .prepare(
          "SELECT * FROM timeline_events ORDER BY chapter_no ASC, story_time ASC"
        )
        .all()
        .map(rowToEvent);
    },
    delete(id: string): void {
      db.prepare("DELETE FROM timeline_events WHERE id=?").run(id);
    },
    deleteFromChapter(fromChapterNo: number): number {
      return db.prepare("DELETE FROM timeline_events WHERE chapter_no >= ?").run(fromChapterNo).changes;
    },
  };
}
