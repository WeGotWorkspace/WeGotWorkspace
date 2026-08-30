import { cleanup, render } from "@testing-library/react";
import type { CSSProperties } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@/notes-core/src/notes-workspace.css";

afterEach(() => cleanup());

function renderPane(tint?: string) {
  return render(
    <div
      className="notes-workspace"
      style={tint ? ({ ["--notes-detail-tint"]: tint } as CSSProperties) : undefined}
    >
      <div className="workspace-detail-pane">
        <div className="workspace-detail-pane__scroll" />
      </div>
    </div>,
  );
}

describe("notes workspace detail tint (computed)", () => {
  it("leaves --notes-detail-tint unset on empty detail so the pane stays cream", () => {
    const { container } = renderPane();
    const root = container.querySelector(".notes-workspace") as HTMLElement;
    expect(getComputedStyle(root).getPropertyValue("--notes-detail-tint").trim()).toBe("");
  });

  it("binds the notebook color onto --notes-detail-tint for a single note", () => {
    const { container } = renderPane("#0ea5e9");
    const root = container.querySelector(".notes-workspace") as HTMLElement;
    expect(getComputedStyle(root).getPropertyValue("--notes-detail-tint").trim()).toBe("#0ea5e9");
  });

  it("resolves --notes-accent to a quieter gold than #f6d176", () => {
    const { container } = renderPane();
    const root = container.querySelector(".notes-workspace") as HTMLElement;
    const probe = document.createElement("span");
    probe.style.color = "var(--notes-accent)";
    root.appendChild(probe);
    expect(getComputedStyle(probe).color).not.toBe("rgb(246, 209, 118)");
    probe.remove();
  });
});
