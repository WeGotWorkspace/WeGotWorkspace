import { cleanup, render } from "@testing-library/react";
import type { CSSProperties } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { notesDetailTintStyle } from "@/notes-core/src/notes-notebook-color";
import "@/notes-core/src/notes-workspace.css";

afterEach(() => cleanup());

function renderPane(tint?: string) {
  return render(
    <div
      className="notes-workspace"
      style={notesDetailTintStyle(tint) as CSSProperties | undefined}
    >
      <div className="workspace-detail-pane">
        <div className="workspace-detail-pane__scroll" />
      </div>
    </div>,
  );
}

describe("notes workspace detail tint (computed)", () => {
  it("leaves --notes-detail-tint unset on empty detail (pane stays the notes-accent wash)", () => {
    const { container } = renderPane();
    const root = container.querySelector(".notes-workspace") as HTMLElement;
    expect(getComputedStyle(root).getPropertyValue("--notes-detail-tint").trim()).toBe("");
  });

  it("binds the notebook color onto --notes-detail-tint for a single note", () => {
    const { container } = renderPane("#0ea5e9");
    const root = container.querySelector(".notes-workspace") as HTMLElement;
    expect(getComputedStyle(root).getPropertyValue("--notes-detail-tint").trim()).toBe("#0ea5e9");
  });

  it("does not force full-ink sheet text; check-mark contrast still follows the fill", () => {
    const light = renderPane("#fde68a");
    const lightRoot = light.container.querySelector(".notes-workspace") as HTMLElement;
    expect(
      getComputedStyle(lightRoot).getPropertyValue("--notes-detail-contrast-fg").trim(),
    ).not.toBe("var(--color-ink)");
    expect(getComputedStyle(lightRoot).getPropertyValue("--notes-detail-check-fg").trim()).toBe(
      "var(--color-ink)",
    );
    light.unmount();

    const dark = renderPane("#1e3a5f");
    const darkRoot = dark.container.querySelector(".notes-workspace") as HTMLElement;
    expect(
      getComputedStyle(darkRoot).getPropertyValue("--notes-detail-contrast-fg").trim(),
    ).not.toBe("var(--color-ink)");
    expect(getComputedStyle(darkRoot).getPropertyValue("--notes-detail-check-fg").trim()).toBe(
      "var(--color-cream)",
    );
    dark.unmount();
  });
});
