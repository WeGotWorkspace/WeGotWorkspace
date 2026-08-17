import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardPanel, CardRowDivider } from "@/card/src/card-panel";
import { CardRow } from "@/card/src/card-row";

describe("CardPanel", () => {
  it("renders rows and a divider inside the panel", () => {
    const { container } = render(
      <CardPanel>
        <CardRow title="All day" leading={<span className="mark">A</span>}>
          <button type="button">Toggle</button>
        </CardRow>
        <CardRowDivider />
        <CardRow title="Starts" subtitle="Optional hint">
          <span>Control</span>
        </CardRow>
      </CardPanel>,
    );

    expect(container.querySelector(".card__panel")).not.toBeNull();
    expect(container.querySelector(".card__row-divider")).not.toBeNull();
    expect(screen.getByText("All day")).toBeTruthy();
    expect(screen.getByText("Optional hint")).toBeTruthy();
    expect(container.querySelector(".card__row-action")?.querySelector("button")).not.toBeNull();
    expect(container.querySelector(".mark")).not.toBeNull();
  });
});
