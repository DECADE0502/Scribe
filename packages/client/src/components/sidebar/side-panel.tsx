import { useEffect, useState } from "react";
import { t } from "../../i18n/zh-CN.js";
import { CharactersPanel } from "./characters-panel.js";
import { OutlinePanel } from "./outline-panel.js";
import { ForeshadowingPanel } from "./foreshadowing-panel.js";
import { TimelinePanel } from "./timeline-panel.js";
import { RulesPanel } from "./rules-panel.js";
import { GenreSectionPanel } from "./genre-section-panel.js";

type BuiltinTabId = "characters" | "outline" | "foreshadowing" | "timeline" | "rules";

const BUILTIN_TABS: Array<{ id: BuiltinTabId; label: string }> = [
  { id: "characters", label: t.sidebar.sectionCharacters },
  { id: "outline", label: t.sidebar.sectionOutline },
  { id: "foreshadowing", label: t.sidebar.sectionForeshadowing },
  { id: "timeline", label: t.sidebar.sectionTimeline },
  { id: "rules", label: t.sidebar.sectionRules },
];

export function SidePanel(props: { bookId: string }) {
  const [tab, setTab] = useState<string>("characters");
  const [genreTabs, setGenreTabs] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/genre-sections`);
        if (!res.ok) return;
        const j = await res.json() as { sections: Array<{ section: { id: string; name: string } }> };
        setGenreTabs(j.sections.map(s => ({ id: `genre:${s.section.id}`, label: s.section.name })));
      } catch { /* 静默,题材 tabs 失败不阻塞内置面板 */ }
    })();
  }, [props.bookId]);

  const isBuiltin = (id: string): id is BuiltinTabId =>
    BUILTIN_TABS.some(b => b.id === id);

  return (
    <div data-testid="side-panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "10px 12px 8px" }}>
        <nav className="segmented">
          {[...BUILTIN_TABS, ...genreTabs].map(item => (
            <button
              key={item.id}
              data-testid={`tab-${item.id}`}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "4px 12px 12px" }}>
        {tab === "characters" && <CharactersPanel bookId={props.bookId} />}
        {tab === "outline" && <OutlinePanel bookId={props.bookId} />}
        {tab === "foreshadowing" && <ForeshadowingPanel bookId={props.bookId} />}
        {tab === "timeline" && <TimelinePanel bookId={props.bookId} />}
        {tab === "rules" && <RulesPanel bookId={props.bookId} />}
        {!isBuiltin(tab) && tab.startsWith("genre:") && (
          <GenreSectionPanel bookId={props.bookId} sectionId={tab.slice("genre:".length)} />
        )}
      </div>
    </div>
  );
}
