import { cleanup, render, screen, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { formatNoteDateForList, formatNoteLastEdited } from "@/notes-core/src/notes-date-utils";
import { notesLastEditedTag } from "@/notes-core/src/notes-last-edited-tag";
import { TooltipProvider } from "@/ui/tooltip";
import { WorkspaceDetailFooter } from "@/workspace-shell/src/workspace-detail-footer";

afterEach(() => {
  cleanup();
});

function renderFooter(ui: ReactElement): RenderResult {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("Notes detail footer via WorkspaceDetailFooter + notesLastEditedTag", () => {
  it("renders a last-edited date chip with clarification in tooltip/aria-label", () => {
    const note = { date: "—", updatedAt: "2026-08-10T12:00:00.000Z" };
    const lastEdited = formatNoteLastEdited(note);
    expect(lastEdited).toBe(formatNoteDateForList("2026-08-10T12:00:00.000Z"));

    const { container } = renderFooter(
      <WorkspaceDetailFooter
        className="notes-detail-footer"
        tags={notesLastEditedTag({ lastEdited, editedLabel: "Last edited" })}
      />,
    );

    const chip = container.querySelector(".workspace-detail-footer__meta-tag--edited");
    expect(chip).toBeTruthy();
    expect(chip!.getAttribute("aria-label")).toBe("Last edited");
    expect(chip!.textContent).toBe(lastEdited);
    expect(screen.getByText(lastEdited)).toBeTruthy();
    expect(screen.queryByText(`Last edited ${lastEdited}`)).toBeNull();
  });

  it("omits the footer when there is no real timestamp", () => {
    const { container } = renderFooter(
      <WorkspaceDetailFooter
        className="notes-detail-footer"
        tags={notesLastEditedTag({ lastEdited: formatNoteLastEdited({ date: "—" }) })}
      />,
    );
    expect(container.querySelector(".notes-detail-footer")).toBeNull();
  });

  it("renders presence start without a last-edited chip", () => {
    const { container } = renderFooter(
      <WorkspaceDetailFooter
        className="notes-detail-footer"
        start={<span data-testid="presence">peers</span>}
        tags={notesLastEditedTag({})}
      />,
    );
    expect(container.querySelector(".notes-detail-footer")).toBeTruthy();
    expect(screen.getByTestId("presence").textContent).toBe("peers");
    expect(container.querySelector(".workspace-detail-footer__meta-tag--edited")).toBeNull();
  });

  it("keeps presence on the left and last-edited on the end", () => {
    const { container } = renderFooter(
      <WorkspaceDetailFooter
        className="notes-detail-footer"
        start={<span data-testid="presence">peers</span>}
        tags={notesLastEditedTag({
          lastEdited: "10 Aug 2026",
          editedLabel: "Last edited",
        })}
      />,
    );
    const footer = container.querySelector(".notes-detail-footer");
    expect(footer).toBeTruthy();
    const groups = footer!.querySelectorAll(".workspace-chrome-footer__group");
    expect(groups.length).toBe(2);
    expect(groups[0]!.querySelector("[data-testid='presence']")).toBeTruthy();
    expect(groups[1]!.className).toContain("workspace-chrome-footer__group--end");
    expect(groups[1]!.querySelector(".workspace-detail-footer__meta-tag--edited")).toBeTruthy();
  });
});
