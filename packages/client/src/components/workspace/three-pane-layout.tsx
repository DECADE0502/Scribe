import type { ReactNode } from "react";

export interface ThreePaneLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

export function ThreePaneLayout(props: ThreePaneLayoutProps) {
  return (
    <div className="three-pane">
      <section
        data-testid="pane-conversation"
        className="three-pane__pane three-pane__pane--conversation"
      >
        {props.left}
      </section>
      <section
        data-testid="pane-editor"
        className="three-pane__pane three-pane__pane--editor"
      >
        {props.center}
      </section>
      <section
        data-testid="pane-sidebar"
        className="three-pane__pane three-pane__pane--sidebar"
      >
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
