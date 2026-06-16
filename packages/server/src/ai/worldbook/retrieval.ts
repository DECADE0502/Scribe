import type { WorldbookEntry } from "@scribe/shared";

export interface WorldbookRetrievalInput {
  entries: WorldbookEntry[];
  query: string;
  extraText?: string[];
  tokenBudget?: number;
  random?: () => number;
}

export type RetrievedWorldbookReason =
  | "constant"
  | "trigger"
  | "recursive"
  | "probability"
  | "excludeRecursion"
  | "budget";

export interface RetrievedWorldbookEntry {
  entry: WorldbookEntry;
  matchedKeys: string[];
  reason: RetrievedWorldbookReason;
  recursionDepth: number;
  insertionDepth: number;
}

export interface WorldbookRetrievalDiagnostic {
  entryId: string;
  title: string;
  matchedKeys: string[];
  reason: RetrievedWorldbookReason;
  recursionDepth: number;
  decision: "selected" | "dropped";
  notes: string[];
}

export interface WorldbookRetrievalResult {
  selected: RetrievedWorldbookEntry[];
  dropped: RetrievedWorldbookEntry[];
  usedTokens: number;
  diagnostics?: WorldbookRetrievalDiagnostic[];
}

function normalizeAscii(text: string): string {
  return text.toLowerCase();
}

function sillytavernMetadata(entry: WorldbookEntry): Record<string, unknown> {
  const value = entry.metadata.sillytavern;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keyMatches(
  key: string,
  haystack: string,
  opts: { caseSensitive: boolean; wholeWords: boolean },
): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (opts.wholeWords) {
    const flags = opts.caseSensitive ? "u" : "iu";
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}_])`, flags)
      .test(haystack);
  }
  return opts.caseSensitive
    ? haystack.includes(trimmed)
    : normalizeAscii(haystack).includes(normalizeAscii(trimmed));
}

function matchedKeyList(
  keys: string[],
  haystack: string,
  opts: { caseSensitive: boolean; wholeWords: boolean },
): string[] {
  return keys.filter((key) => {
    const trimmed = key.trim();
    if (!trimmed) return false;
    return keyMatches(trimmed, haystack, opts);
  });
}

function findMatchedKeys(entry: WorldbookEntry, haystack: string): string[] {
  const meta = sillytavernMetadata(entry);
  const opts = {
    caseSensitive: meta.caseSensitive === true,
    wholeWords: meta.matchWholeWords === true,
  };
  const primaryMatches = matchedKeyList(entry.keys, haystack, opts);
  const secondaryMatches = matchedKeyList(entry.secondaryKeys, haystack, opts);
  if (meta.selective === true && entry.secondaryKeys.length > 0) {
    return primaryMatches.length > 0 && secondaryMatches.length > 0
      ? [...primaryMatches, ...secondaryMatches]
      : [];
  }
  return [...primaryMatches, ...secondaryMatches];
}

function scanTextForEntry(
  entry: WorldbookEntry,
  query: string,
  extraText: string[],
): string {
  const meta = sillytavernMetadata(entry);
  const scanDepth = typeof meta.scanDepth === "number"
    ? Math.trunc(meta.scanDepth)
    : null;
  const parts = [query, ...extraText];
  if (scanDepth !== null && scanDepth > 0) {
    return parts.slice(-scanDepth).join("\n");
  }
  return parts.join("\n");
}

function probabilityAllows(
  entry: WorldbookEntry,
  random: () => number,
): boolean {
  const meta = sillytavernMetadata(entry);
  if (meta.useProbability !== true) return true;
  const probability = typeof meta.probability === "number" ? meta.probability : 100;
  const clamped = Math.max(0, Math.min(100, probability));
  return random() * 100 < clamped;
}

function excludesRecursiveSelection(entry: WorldbookEntry): boolean {
  const meta = sillytavernMetadata(entry);
  return meta.excludeRecursion === true || meta.preventRecursion === true;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function entryTokenCost(item: RetrievedWorldbookEntry): number {
  return estimateTokens(`${item.entry.title}\n${item.entry.content}`);
}

function sortRetrieved(
  items: RetrievedWorldbookEntry[],
): RetrievedWorldbookEntry[] {
  const reasonRank = (reason: RetrievedWorldbookEntry["reason"]) =>
    reason === "trigger" ? 0 : reason === "recursive" ? 1 : 2;
  return [...items].sort((a, b) => {
    const priorityDelta = b.entry.priority - a.entry.priority;
    if (priorityDelta !== 0) return priorityDelta;
    const reasonDelta = reasonRank(a.reason) - reasonRank(b.reason);
    if (reasonDelta !== 0) return reasonDelta;
    const depthDelta = a.recursionDepth - b.recursionDepth;
    if (depthDelta !== 0) return depthDelta;
    return a.entry.updatedAt - b.entry.updatedAt;
  });
}

export function retrieveWorldbookEntries(
  input: WorldbookRetrievalInput,
): WorldbookRetrievalResult {
  const enabled = input.entries.filter((entry) => entry.enabled);
  const selected = new Map<string, RetrievedWorldbookEntry>();
  const preBudgetDropped: RetrievedWorldbookEntry[] = [];
  const diagnostics: WorldbookRetrievalDiagnostic[] = [];
  const extraText = input.extraText ?? [];
  const random = input.random ?? Math.random;

  const recordDiagnostic = (
    item: RetrievedWorldbookEntry,
    decision: WorldbookRetrievalDiagnostic["decision"],
    notes: string[] = [],
  ) => {
    diagnostics.push({
      entryId: item.entry.id,
      title: item.entry.title,
      matchedKeys: item.matchedKeys,
      reason: item.reason,
      recursionDepth: item.recursionDepth,
      decision,
      notes,
    });
  };

  for (const entry of enabled) {
    if (entry.constant || entry.activation === "constant") {
      const item = {
        entry,
        matchedKeys: [],
        reason: "constant",
        recursionDepth: 0,
        insertionDepth: entry.insertionDepth,
      } satisfies RetrievedWorldbookEntry;
      selected.set(entry.id, item);
      recordDiagnostic(item, "selected");
      continue;
    }
    const matchedKeys = findMatchedKeys(
      entry,
      scanTextForEntry(entry, input.query, extraText),
    );
    if (matchedKeys.length) {
      const triggerItem = {
        entry,
        matchedKeys,
        reason: "trigger",
        recursionDepth: 0,
        insertionDepth: entry.insertionDepth,
      } satisfies RetrievedWorldbookEntry;
      if (!probabilityAllows(entry, random)) {
        const droppedItem = { ...triggerItem, reason: "probability" } satisfies RetrievedWorldbookEntry;
        preBudgetDropped.push(droppedItem);
        recordDiagnostic(droppedItem, "dropped", ["SillyTavern probability gate failed."]);
        selected.delete(entry.id);
        continue;
      }
      selected.set(entry.id, triggerItem);
      recordDiagnostic(triggerItem, "selected");
    }
  }

  const queue = [...selected.values()];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    const maxDepth = current.entry.recursive ? current.entry.recursionLimit : 0;
    if (current.recursionDepth >= maxDepth) continue;

    for (const candidate of enabled) {
      if (selected.has(candidate.id)) continue;
      if (candidate.constant || candidate.activation === "constant") continue;
      const matchedKeys = findMatchedKeys(candidate, current.entry.content);
      if (!matchedKeys.length) continue;
      if (excludesRecursiveSelection(candidate)) {
        const droppedItem = {
          entry: candidate,
          matchedKeys,
          reason: "excludeRecursion",
          recursionDepth: current.recursionDepth + 1,
          insertionDepth: candidate.insertionDepth,
        } satisfies RetrievedWorldbookEntry;
        preBudgetDropped.push(droppedItem);
        recordDiagnostic(droppedItem, "dropped", [
          "SillyTavern recursion metadata prevents recursive activation.",
        ]);
        continue;
      }
      if (!probabilityAllows(candidate, random)) {
        const droppedItem = {
          entry: candidate,
          matchedKeys,
          reason: "probability",
          recursionDepth: current.recursionDepth + 1,
          insertionDepth: candidate.insertionDepth,
        } satisfies RetrievedWorldbookEntry;
        preBudgetDropped.push(droppedItem);
        recordDiagnostic(droppedItem, "dropped", ["SillyTavern probability gate failed."]);
        continue;
      }

      const item: RetrievedWorldbookEntry = {
        entry: candidate,
        matchedKeys,
        reason: "recursive",
        recursionDepth: current.recursionDepth + 1,
        insertionDepth: candidate.insertionDepth,
      };
      selected.set(candidate.id, item);
      queue.push(item);
      recordDiagnostic(item, "selected");
    }
  }

  const ordered = sortRetrieved([...selected.values()]);
  if (!input.tokenBudget || input.tokenBudget <= 0) {
    return {
      selected: ordered,
      dropped: preBudgetDropped,
      usedTokens: ordered.reduce((sum, item) => sum + entryTokenCost(item), 0),
      diagnostics,
    };
  }

  const kept: RetrievedWorldbookEntry[] = [];
  const dropped: RetrievedWorldbookEntry[] = [...preBudgetDropped];
  let usedTokens = 0;
  for (const item of ordered) {
    const cost = entryTokenCost(item);
    if (usedTokens + cost <= input.tokenBudget || kept.length === 0) {
      kept.push(item);
      usedTokens += cost;
    } else {
      const droppedItem = { ...item, reason: "budget" } satisfies RetrievedWorldbookEntry;
      dropped.push(droppedItem);
      recordDiagnostic(droppedItem, "dropped", ["Worldbook token budget was exceeded."]);
    }
  }

  return { selected: kept, dropped, usedTokens, diagnostics };
}

export function renderWorldbookEntries(
  entries: RetrievedWorldbookEntry[],
): string {
  if (!entries.length) return "";
  const grouped = new Map<number, RetrievedWorldbookEntry[]>();
  for (const item of entries) {
    const group = grouped.get(item.insertionDepth) ?? [];
    group.push(item);
    grouped.set(item.insertionDepth, group);
  }

  const parts = ["## Worldbook"];
  for (const depth of [...grouped.keys()].sort((a, b) => a - b)) {
    parts.push(`\n### Depth ${depth}`);
    for (const item of sortRetrieved(grouped.get(depth)!)) {
      const label = item.entry.category
        ? `[${item.entry.category}] ${item.entry.title}`
        : item.entry.title;
      parts.push(`\n### ${label}`);
      parts.push(item.entry.content);
    }
  }
  return parts.join("\n");
}
