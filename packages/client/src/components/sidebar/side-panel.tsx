import { useState } from "react";
import { t } from "../../i18n/zh-CN.js";
import { CharactersPanel } from "./characters-panel.js";
import { OutlinePanel } from "./outline-panel.js";
import { ForeshadowingPanel } from "./foreshadowing-panel.js";
import { TimelinePanel } from "./timeline-panel.js";
import { RulesPanel } from "./rules-panel.js";

type TabId = "characters" | "outline" | "foreshadowing" | "timeline" | "rules";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "characters", label: t.sidebar.sectionCharacters },
  { id: "outline", label: t.sidebar.sectionOutline },
  { id: "foreshadowing", label: t.sidebar.sectionForeshadowing },
  { id: "timeline", label: t.sidebar.sectionTimeline },
  { id: "rules", label: t.sidebar.sectionRules },
];

export function SidePanel(props: { bookId: string }) {
  const [tab, setTab] = useState<TabId>("characters");
  return (
    <div data-testid="side-panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <nav style={{ display: "flex", borderBottom: "1px solid #e5e5e5", flexWrap: "wrap" }}>
        {TABS.map(item => (
          <button
            key={item.id}
            data-testid={`tab-${item.id}`}
            onClick={() => setTab(item.id)}
            style={{
              border: "none",
              borderBottom: tab === item.id ? "2px solid #1a73e8" : "2px solid transparent",
              borderRadius: 0,
              background: "transparent",
              padding: "8px 10px",
              fontWeight: tab === item.id ? 600 : 400,
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {tab === "characters" && <CharactersPanel bookId={props.bookId} />}
        {tab === "outline" && <OutlinePanel bookId={props.bookId} />}
        {tab === "foreshadowing" && <ForeshadowingPanel bookId={props.bookId} />}
        {tab === "timeline" && <TimelinePanel bookId={props.bookId} />}
        {tab === "rules" && <RulesPanel bookId={props.bookId} />}
      </div>
    </div>
  );
}
