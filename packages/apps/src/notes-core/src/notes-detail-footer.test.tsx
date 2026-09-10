import { cleanup, render, screen, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { formatNoteDateForList, formatNoteLastEdited } from "@/notes-core/src/notes-date-utils";
import { NotesDetailFooter } from "@/notes-core/src/notes-detail-footer";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(() => {
  cleanup();
});

function renderFooter(ui: ReactElement): RenderResult {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("NotesDetailFooter", () => {
  it("renders a last-edited date chip with clarification in tooltip/aria-label", () => {
    const note = { date: "—", updatedAt: "2026-08-10T12:00:00.000Z" };
    const lastEdited = formatNoteLastEdited(note);
    expect(lastEdited).toBe(formatNoteDateForList("2026-08-10T12:00:00.000Z"));

    const { container } = renderFooter(
      <NotesDetailFooter lastEdited={lastEdited} editedLabel="Last edited" />,
    );

    const chip = container.querySelector(".notes-detail-footer__meta-tag--edited");
    expect(chip).toBeTruthy();
    expect(chip!.getAttribute("aria-label")).toBe("Last edited");
    expect(chip!.textContent).toBe(lastEdited);
    expect(screen.getByText(lastEdited)).toBeTruthy();
    expect(screen.queryByText(`Last edited ${lastEdited}`)).toBeNull();
  });

  it("omits the footer when there is no real timestamp", () => {
    const { container } = renderFooter(
      <NotesDetailFooter lastEdited={formatNoteLastEdited({ date: "—" })} />,
    );
    expect(container.querySelector(".notes-detail-footer")).toBeNull();
  });
});
