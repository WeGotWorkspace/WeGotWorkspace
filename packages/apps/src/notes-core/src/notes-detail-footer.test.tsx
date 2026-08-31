import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatNoteDateForList, formatNoteLastEdited } from "@/notes-core/src/notes-date-utils";
import { NotesDetailFooter } from "@/notes-core/src/notes-detail-footer";

afterEach(() => {
  cleanup();
});

describe("NotesDetailFooter", () => {
  it("renders a last-edited label from note updatedAt", () => {
    const note = { date: "—", updatedAt: "2026-08-10T12:00:00.000Z" };
    const lastEdited = formatNoteLastEdited(note);
    expect(lastEdited).toBe(formatNoteDateForList("2026-08-10T12:00:00.000Z"));

    const { container } = render(
      <NotesDetailFooter lastEdited={lastEdited} editedLabel="Last edited " />,
    );

    const chip = container.querySelector(".notes-detail-footer__meta-tag--edited");
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toBe(`Last edited ${lastEdited}`);
    expect(screen.getByText(`Last edited ${lastEdited}`)).toBeTruthy();
  });

  it("omits the footer when there is no real timestamp", () => {
    const { container } = render(
      <NotesDetailFooter lastEdited={formatNoteLastEdited({ date: "—" })} />,
    );
    expect(container.querySelector(".notes-detail-footer")).toBeNull();
  });
});
