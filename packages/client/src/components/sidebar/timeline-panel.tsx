import { useEffect, useState } from "react";
import { t } from "../../i18n/zh-CN.js";

interface TimelineEvent {
  id: string;
  chapterNo: number;
  storyTime: string;
  event: string;
  participants: string[];
}

export function TimelinePanel(props: { bookId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/timeline`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json() as { timeline: TimelineEvent[] };
        setEvents(j.timeline);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [props.bookId]);

  const byChapter = new Map<number, TimelineEvent[]>();
  for (const ev of events) {
    const list = byChapter.get(ev.chapterNo) ?? [];
    list.push(ev);
    byChapter.set(ev.chapterNo, list);
  }
  const chapters = [...byChapter.keys()].sort((a, b) => a - b);

  return (
    <div data-testid="timeline-panel">
      {error && <p role="alert" style={{ color: "#c00" }}>{error}</p>}
      {chapters.length === 0 && <p data-testid="timeline-empty" style={{ color: "#999" }}>{t.common.empty}</p>}
      {chapters.map(no => (
        <div key={no} data-testid={`timeline-chapter-${no}`} style={{ marginBottom: 10 }}>
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>第 {no} 章</p>
          {byChapter.get(no)!.map(ev => (
            <div key={ev.id} style={{ fontSize: 13, marginLeft: 8, marginBottom: 4 }}>
              <span style={{ color: "#888" }}>{ev.storyTime}</span> — {ev.event}
              {ev.participants.length > 0 && (
                <span style={{ color: "#aaa", fontSize: 11 }}>({ev.participants.join("、")})</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
