import type { ReactNode } from "react";

export interface ThreePaneLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

export function ThreePaneLayout(props: ThreePaneLayoutProps) {
  return (
    <div
      className="three-pane"
      style={{
        display: "grid",
        gridTemplateColumns: "30% 45% 25%",
        height: "100vh",
        gap: 0,
      }}
    >
      <section
        data-testid="pane-conversation"
        style={{ borderRight: "1px solid #e5e5e5", overflow: "auto" }}
      >
        {props.left}
      </section>
      <section
        data-testid="pane-editor"
        style={{ borderRight: "1px solid #e5e5e5", overflow: "auto" }}
      >
        {props.center}
      </section>
      <section data-testid="pane-sidebar" style={{ overflow: "auto" }}>
        {props.right}
      </section>
    </div>
  );
}

export function EmptyPane(props: { label: string; testId?: string }) {
  return (
    <div
      data-testid={props.testId}
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#999",
      }}
    >
      {props.label}
    </div>
  );
}
