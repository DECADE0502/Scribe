import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  NewWorldbookEntryInputSchema,
  WorldbookEntryPatchSchema,
  type NewWorldbookEntryInput,
  type WorldbookEntry,
} from "@scribe/shared";

export interface WorldbookRepoLike {
  create(input: NewWorldbookEntryInput): WorldbookEntry;
  get(id: string): WorldbookEntry | undefined;
  list(opts?: { enabledOnly?: boolean }): WorldbookEntry[];
  update(id: string, patch: Partial<NewWorldbookEntryInput>): WorldbookEntry;
  delete(id: string): void;
}

export interface WorldbookToolsDeps {
  repo: WorldbookRepoLike;
}

export function makeWorldbookTools(
  deps: WorldbookToolsDeps,
): Record<string, Tool> {
  return {
    create_worldbook_entry: tool({
      description:
        "Persist a stable worldbook entry for long-term novel settings. Use this for world rules, core character facts, locations, factions, style contracts, and other knowledge that should be retrieved before drafting.",
      parameters: NewWorldbookEntryInputSchema.describe(
        "Worldbook entry to create. Prefer constant=true for always-on core contracts; use keys for triggered entries.",
      ),
      execute: async (args) => deps.repo.create(args),
    }),

    update_worldbook_entry: tool({
      description:
        "Update an existing worldbook entry by id. Use partial fields; omitted fields stay unchanged.",
      parameters: z.object({
        id: z.string().min(1),
        patch: WorldbookEntryPatchSchema,
      }),
      execute: async ({ id, patch }) => {
        if (!deps.repo.get(id)) {
          throw new Error(`Worldbook entry not found: ${id}`);
        }
        return deps.repo.update(id, patch);
      },
    }),

    delete_worldbook_entry: tool({
      description: "Delete a worldbook entry by id.",
      parameters: z.object({ id: z.string().min(1) }),
      execute: async ({ id }) => {
        if (!deps.repo.get(id)) {
          throw new Error(`Worldbook entry not found: ${id}`);
        }
        deps.repo.delete(id);
        return { deleted: id };
      },
    }),
  };
}
