import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../src/App.js";

describe("App smoke", () => {
  it("渲染应用标题", () => {
    render(<App />);
    expect(screen.getByText(/Scribe 小说引擎/)).toBeInTheDocument();
  });
});
