import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceDetailFooter } from "@/workspace-shell/src/workspace-detail-footer";

afterEach(() => {
  cleanup();
});

describe("WorkspaceDetailFooter", () => {
  it("places start left and tags+end in the end group", () => {
    const { container } = render(
      <WorkspaceDetailFooter
        start={<span data-testid="start">peers</span>}
        tags={<span data-testid="tags">meta</span>}
        end={<span data-testid="end">status</span>}
      />,
    );

    const footer = container.querySelector(".workspace-detail-footer");
    expect(footer).toBeTruthy();
    expect(footer!.className).toContain("workspace-chrome-footer");

    const groups = footer!.querySelectorAll(".workspace-chrome-footer__group");
    expect(groups.length).toBe(2);
    expect(groups[0]!.querySelector("[data-testid='start']")).toBeTruthy();
    expect(groups[1]!.className).toContain("workspace-chrome-footer__group--end");
    expect(groups[1]!.querySelector("[data-testid='tags']")).toBeTruthy();
    expect(groups[1]!.querySelector("[data-testid='end']")).toBeTruthy();
    expect(screen.getByTestId("tags").compareDocumentPosition(screen.getByTestId("end"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("renders tags alone in the end group without a start slot", () => {
    const { container } = render(
      <WorkspaceDetailFooter tags={<span data-testid="tags">words</span>} />,
    );

    const groups = container.querySelectorAll(".workspace-chrome-footer__group");
    expect(groups.length).toBe(1);
    expect(groups[0]!.className).toContain("workspace-chrome-footer__group--end");
    expect(screen.getByTestId("tags")).toBeTruthy();
  });

  it("omits the footer when all slots are empty", () => {
    const { container } = render(<WorkspaceDetailFooter />);
    expect(container.querySelector(".workspace-detail-footer")).toBeNull();
  });
});
