import { useNavigate, useParams } from "react-router-dom";
import { t } from "../i18n/zh-CN.js";
import { ThreePaneLayout, EmptyPane } from "../components/workspace/three-pane-layout.js";
import { ConversationPane } from "../components/conversation/conversation-pane.js";
import { SidePanel } from "../components/sidebar/side-panel.js";
import { UsageMeter } from "../components/usage-meter.js";

export function WorkspacePage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  return (
    <div data-testid="page-workspace" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid #e5e5e5",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button onClick={() => navigate("/library")}>{t.workspace.backToLibrary}</button>
        <span style={{ color: "#666" }} data-testid="book-id-label">
          {bookId}
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
          center={<EmptyPane testId="placeholder-editor" label={t.workspace.tabEditor} />}
          right={bookId
            ? <SidePanel bookId={bookId} />
            : <EmptyPane testId="placeholder-sidebar" label={t.workspace.tabSidebar} />}
        />
      </div>
    </div>
  );
}
