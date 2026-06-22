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

const BUILTIN_TABS: Array<{ id: BuiltinTabId; label: string; icon: string }> = [
  { id: "meta", label: "设定", icon: "⚙️" },
  { id: "characters", label: t.sidebar.sectionCharacters, icon: "👤" },
  { id: "outline", label: t.sidebar.sectionOutline, icon: "🗂️" },
  { id: "foreshadowing", label: t.sidebar.sectionForeshadowing, icon: "🔖" },
  { id: "timeline", label: t.sidebar.sectionTimeline, icon: "🕒" },
  { id: "import", label: "导入", icon: "⬇️" },
  { id: "presets", label: "预设", icon: "🎛️" },
  { id: "worldbook", label: "世界书", icon: "🌐" },
  { id: "rules", label: t.sidebar.sectionRules, icon: "📐" },
];

const GENRE_ICON = "🏷️";

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

  const allItems: Array<{ id: string; label: string; icon: string }> = [
    ...BUILTIN_TABS,
    ...genreTabs.map((g) => ({ ...g, icon: GENRE_ICON })),
  ];

  const renderPanel = (id: string) => {
    switch (id) {
      case "meta": return <MetaPanel bookId={props.bookId} />;
      case "characters": return <CharactersPanel bookId={props.bookId} />;
      case "outline": return <OutlinePanel bookId={props.bookId} />;
      case "foreshadowing": return <ForeshadowingPanel bookId={props.bookId} />;
      case "timeline": return <TimelinePanel bookId={props.bookId} />;
      case "import": return <ImportDialog bookId={props.bookId} onImported={() => undefined} />;
      case "presets": return <PresetPanel bookId={props.bookId} />;
      case "worldbook": return <WorldbookPanel bookId={props.bookId} />;
      case "rules": return <RulesPanel bookId={props.bookId} />;
      default:
        return id.startsWith("genre:")
          ? <GenreSectionPanel bookId={props.bookId} sectionId={id.slice("genre:".length)} />
          : null;
    }
  };

  return (
    <div data-testid="side-panel" className="side-panel-shell">
      <nav className="side-tab-bar" data-testid="side-panel-tab-rail" aria-label="资料板块">
        {allItems.map((item) => (
          <button
            key={item.id}
            data-testid={`tab-${item.id}`}
            className={`side-tab-chip${tab === item.id ? " active" : ""}`}
            title={item.label}
            onClick={() => setTab(item.id)}
          >
            <span className="side-tab-chip-icon" aria-hidden>{item.icon}</span>
            <span className="side-tab-chip-text">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="side-panel-content">
        {renderPanel(tab)}
      </div>
    </div>
  );
}
