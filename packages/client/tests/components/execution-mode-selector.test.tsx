import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExecutionModeSelector } from "../../src/components/conversation/execution-mode-selector.js";
import { useConversationStore } from "../../src/stores/conversation.js";

describe("ExecutionModeSelector", () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
    useConversationStore.getState().setExecutionMode("low_risk_auto");
  });

  it("shows low-risk auto by default and updates mode", () => {
    render(<ExecutionModeSelector />);

    const select = screen.getByTestId("execution-mode-selector") as HTMLSelectElement;
    expect(select.value).toBe("low_risk_auto");

    fireEvent.change(select, { target: { value: "plan_only" } });

    expect(useConversationStore.getState().executionMode).toBe("plan_only");
  });
});
