import { useEffect, useState } from "react";
import { t } from "../../i18n/zh-CN.js";
import { CharactersPanel } from "./characters-panel.js";
import { OutlinePanel } from "./outline-panel.js";
import { ForeshadowingPanel } from "./foreshadowing-panel.js";
import { TimelinePanel } from "./timeline-panel.js";
import { RulesPanel } from "./rules-panel.js";
import { GenreSectionPanel } from "./genre-section-panel.js";
import { MetaPanel } from "./meta-panel.js";
import { WorldbookPanel } from "../worldbook/worldbook-panel.js";
import { ImportDialog } from "../import/import-dialog.js";
import { PresetPanel } from "../presets/preset-panel.js";

type BuiltinTabId =
  | "meta"
  | "characters"
  | "outline"
  | "foreshadowing"
  | "timeline"
  | "import"
  | "presets"
  | "worldbook"
  | "rules";

const BUILTIN_TABS: Array<{ id: BuiltinTabId; label: string }> = [
  { id: "meta", label: "设定" },
  { id: "characters", label: t.sidebar.sectionCharacters },
  { id: "outline", label: t.sidebar.sectionOutline },
  { id: "foreshadowing", label: t.sidebar.sectionForeshadowing },
  { id: "timeline", label: t.sidebar.sectionTimeline },
  { id: "import", label: "导入" },
  { id: "presets", label: "预设" },
  { id: "worldbook", label: "世界书" },
  { id: "rules", label: t.sidebar.sectionRules },
];

function compactTabLabel(label: string) {
  const chars = Array.from(label);
  const isAsciiWord = chars.length > 0 && chars.every((char) => {
    const code = char.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  });
  if (isAsciiWord) return chars.slice(0, 3).join("");
  return Array.from(label).slice(0, 2).join("");
}

export function SidePanel(props: { bookId: string }) {
  const [tab, setTab] = useState<string>("meta");
  const [genreTabs, setGenreTabs] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/genre-sections`);
        if (!res.ok) return;
        const j = await res.json() as { sections: Array<{ section: { id: string; name: string } }> };
        setGenreTabs(j.sections.map((s) => ({ id: `genre:${s.section.id}`, label: s.section.name })));
      } catch {
        // Sidebar genre tabs are best-effort; built-in tabs should remain usable.
      }
    })();
  }, [props.bookId]);

  const isBuiltin = (id: string): id is BuiltinTabId =>
    BUILTIN_TABS.some((b) => b.id === id);

  return (
    <div data-testid="side-panel" className="side-panel-shell">
      <nav className="side-tab-rail" data-testid="side-panel-tab-rail" aria-label="Sidebar sections">
        {[...BUILTIN_TABS, ...genreTabs].map((item) => (
          <button
            key={item.id}
            data-testid={`tab-${item.id}`}
            className={`side-tab-button${tab === item.id ? " active" : ""}`}
            title={item.label}
            aria-label={item.label}
            onClick={() => setTab(item.id)}
          >
            <span className="side-tab-label">{compactTabLabel(item.label)}</span>
          </button>
        ))}
      </nav>
      <div className="side-panel-content">
        {tab === "meta" && <MetaPanel bookId={props.bookId} />}
        {tab === "characters" && <CharactersPanel bookId={props.bookId} />}
        {tab === "outline" && <OutlinePanel bookId={props.bookId} />}
        {tab === "foreshadowing" && <ForeshadowingPanel bookId={props.bookId} />}
        {tab === "timeline" && <TimelinePanel bookId={props.bookId} />}
        {tab === "import" && <ImportDialog bookId={props.bookId} onImported={() => undefined} />}
        {tab === "presets" && <PresetPanel bookId={props.bookId} />}
        {tab === "worldbook" && <WorldbookPanel bookId={props.bookId} />}
        {tab === "rules" && <RulesPanel bookId={props.bookId} />}
        {!isBuiltin(tab) && tab.startsWith("genre:") && (
          <GenreSectionPanel bookId={props.bookId} sectionId={tab.slice("genre:".length)} />
        )}
      </div>
    </div>
  );
}
