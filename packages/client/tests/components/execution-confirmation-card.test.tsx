import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { buildExecutionPolicy } from "@scribe/shared";
import { ExecutionConfirmationCard } from "../../src/components/conversation/execution-confirmation-card.js";

describe("ExecutionConfirmationCard", () => {
  it("renders policy reason and button callbacks", () => {
    const onApprove = vi.fn();
    const onReroll = vi.fn();
    const onCancel = vi.fn();
    const policy = buildExecutionPolicy({
      taskId: "task-1",
      configuredMode: "low_risk_auto",
      actions: [{ type: "chapter_write" }],
    });

    render(
      <ExecutionConfirmationCard
        taskId="task-1"
        message="Confirmation required before writing chapters."
        policy={policy}
        onApprove={onApprove}
        onReroll={onReroll}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText(/Confirmation required/)).toBeInTheDocument();
    expect(screen.getByText(/low_risk_auto/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("execution-approve"));
    fireEvent.click(screen.getByTestId("execution-reroll"));
    fireEvent.click(screen.getByTestId("execution-cancel"));

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReroll).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
