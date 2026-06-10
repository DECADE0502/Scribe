import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ToastContainer } from "../../src/components/toast.js";
import { useToastStore } from "../../src/stores/toast.js";

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast 系统", () => {
  it("error toast 常驻直到点叉", async () => {
    render(<ToastContainer />);
    act(() => {
      useToastStore.getState().push({ level: "error", text: "API key 无效或过期,请到设置中更新" });
    });
    expect(screen.getByTestId("toast-error")).toHaveTextContent("API key 无效");
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByTestId("toast-error")).toBeInTheDocument(); // 仍在
    const id = useToastStore.getState().toasts[0]!.id;
    fireEvent.click(screen.getByTestId(`toast-dismiss-${id}`));
    expect(screen.queryByTestId("toast-error")).not.toBeInTheDocument();
  });

  it("info toast 3 秒自动消失", () => {
    render(<ToastContainer />);
    act(() => {
      useToastStore.getState().push({ level: "info", text: "已保存" });
    });
    expect(screen.getByTestId("toast-info")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3100); });
    expect(screen.queryByTestId("toast-info")).not.toBeInTheDocument();
  });

  it("action 按钮可点", () => {
    const onClick = vi.fn();
    render(<ToastContainer />);
    act(() => {
      useToastStore.getState().push({
        level: "error", text: "超过单次预算上限",
        action: { label: "去设置", onClick },
      });
    });
    fireEvent.click(screen.getByText("去设置"));
    expect(onClick).toHaveBeenCalled();
  });

  it("多个 toast 堆叠", () => {
    render(<ToastContainer />);
    act(() => {
      useToastStore.getState().push({ level: "error", text: "错误一" });
      useToastStore.getState().push({ level: "error", text: "错误二" });
    });
    expect(screen.getAllByTestId("toast-error")).toHaveLength(2);
  });
});
