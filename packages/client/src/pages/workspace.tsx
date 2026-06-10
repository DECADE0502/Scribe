import { useNavigate, useParams } from "react-router-dom";
import { t } from "../i18n/zh-CN.js";
import { ThreePaneLayout, EmptyPane } from "../components/workspace/three-pane-layout.js";
import { ConversationPane } from "../components/conversation/conversation-pane.js";
import { SidePanel } from "../components/sidebar/side-panel.js";
import { UsageMeter } from "../components/usage-meter.js";
import { EditorPane } from "../components/editor/editor-pane.js";

export function WorkspacePage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  return (
    <div data-testid="page-workspace" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header className="nav-bar">
        <button className="ios-btn-small" onClick={() => navigate("/library")}>
          ‹ {t.workspace.backToLibrary}
        </button>
        <span className="muted" style={{ fontSize: 12 }} data-testid="book-id-label">
          {bookId?.slice(0, 8)}
        </span>
        <span style={{ marginLeft: "auto" }}>
          {bookId && <UsageMeter bookId={bookId} />}
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ThreePaneLayout
          left={bookId
            ? <ConversationPane bookId={bookId} />
            : <EmptyPane testId="placeholder-conversation" label={t.workspace.tabConversation} />}
          center={bookId
            ? <EditorPane bookId={bookId} />
            : <EmptyPane testId="placeholder-editor" label={t.workspace.tabEditor} />}
          right={bookId
            ? <SidePanel bookId={bookId} />
            : <EmptyPane testId="placeholder-sidebar" label={t.workspace.tabSidebar} />}
        />
      </div>
    </div>
  );
}
