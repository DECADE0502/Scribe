import type { BookHandle } from "../../http/book-registry.js";
import type { createWorkflowRunsRepo } from "../../db/repositories/workflow-runs.js";

export interface StagedChange {
  id: string;
  type:
    | "chapter_version"
    | "chapter_summary"
    | "chapter_audit"
    | "character_upsert"
    | "outline_upsert"
    | "timeline_event"
    | "foreshadowing_upsert"
    | "worldbook_upsert"
    | "record_upsert";
  payload: unknown;
  sortOrder?: number;
}

export interface CommitResult {
  committed: StagedChange[];
  failed: { change: StagedChange; error: string }[];
}

export interface WorkflowStaging {
  begin(runId: string, opts: { bookId: string; source: string }): void;
  add(runId: string, change: StagedChange): void;
  commit(runId: string, handle: BookHandle): CommitResult;
  discard(runId: string): void;
}

export function createWorkflowStaging(
  runsRepo: ReturnType<typeof createWorkflowRunsRepo>,
) {
  return {
    begin(runId: string, opts: { bookId: string; source: string }): void {
      runsRepo.create(opts.bookId, opts.source);
    },
    add(runId: string, change: StagedChange): void {
      runsRepo.addChange(runId, {
        id: change.id,
        type: change.type,
        payload: change.payload,
        sortOrder: change.sortOrder ?? 0,
      });
    },
    commit(runId: string, handle: BookHandle): CommitResult {
      const changes = runsRepo.listChanges(runId);
      const committed: StagedChange[] = [];
      const failed: { change: StagedChange; error: string }[] = [];

      for (const ch of changes) {
        if (ch.committed) continue;
        try {
          const sc: StagedChange = { id: ch.id, type: ch.type as StagedChange["type"], payload: ch.payload, sortOrder: ch.sortOrder };
          applyChange(handle, sc);
          runsRepo.markChangeCommitted(ch.id);
          committed.push(sc);
        } catch (e) {
          failed.push({ change: { id: ch.id, type: ch.type as StagedChange["type"], payload: ch.payload }, error: (e as Error).message });
        }
      }

      if (failed.length > 0 && committed.length === 0) {
        runsRepo.setPhase(runId, "failed");
      }
      return { committed, failed };
    },
    discard(runId: string): void {
      runsRepo.delete(runId);
    },
  };
}

function applyChange(handle: BookHandle, change: StagedChange): void {
  switch (change.type) {
    case "character_upsert": {
      const p = change.payload as { name: string; role?: string; baseData?: Record<string, unknown>; currentState?: Record<string, unknown> };
      const existing = handle.charactersRepo.list().find((c) => c.name === p.name);
      if (existing) {
        handle.charactersRepo.update(existing.id, {
          currentState: (p.currentState ?? {}) as any,
          baseData: (p.baseData ?? {}) as any,
        });
      } else {
        handle.charactersRepo.create({
          name: p.name,
          role: (p.role as any) ?? "supporting",
          baseData: (p.baseData ?? {}) as any,
          currentState: (p.currentState ?? {}) as any,
        });
      }
      return;
    }
    case "chapter_version": {
      const p = change.payload as { chapterNo: number; content: string; title?: string };
      handle.chapterFiles.save({ chapterNo: p.chapterNo, content: p.content, title: p.title ?? `第 ${p.chapterNo} 章`, versionNo: 1 });
      return;
    }
    case "chapter_summary": {
      const p = change.payload as Parameters<typeof handle.chaptersRepo.saveSummary>[0];
      handle.chaptersRepo.saveSummary(p);
      return;
    }
    case "foreshadowing_upsert": {
      const p = change.payload as { id?: string; label: string; description?: string; plantedChapter: number; status: string; relatedCharacters: string[] };
      if (p.id) {
        handle.foreshadowingRepo.update(p.id, p as any);
      } else {
        handle.foreshadowingRepo.create(p as any);
      }
      return;
    }
    case "timeline_event": {
      const p = change.payload as { chapterNo: number; storyTime: string; event: string; participants: string[] };
      handle.timelineRepo.create(p);
      return;
    }
    case "outline_upsert": {
      const p = change.payload as { id?: string; parentId?: string | null; level: "volume" | "arc" | "chapter"; title: string; summary?: string; metadata?: Record<string, unknown> };
      if (p.id) {
        handle.outlineRepo.update(p.id, p as any);
      } else {
        handle.outlineRepo.create(p as any);
      }
      return;
    }
    case "worldbook_upsert": {
      const p = change.payload as { id?: string; title: string; content: string; keys: string[]; enabled: boolean };
      if (p.id) {
        handle.worldbookRepo.update(p.id, p as any);
      } else {
        handle.worldbookRepo.create(p as any);
      }
      return;
    }
    case "record_upsert": {
      const p = change.payload as { sectionId: string; item: Record<string, unknown> };
      handle.genreSectionsRepo.addItem(p.sectionId, p.item);
      return;
    }
  }
}
