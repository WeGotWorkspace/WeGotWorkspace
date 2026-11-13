import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defaultNoteBodyLabels } from "./note-body-labels";
import { NoteExternalWriteDialog } from "./note-external-write-dialog";

describe("NoteExternalWriteDialog", () => {
  it("tells the person the note changed outside the app", () => {
    render(
      <NoteExternalWriteDialog
        open
        noteTitle="Shopping"
        labels={defaultNoteBodyLabels}
        onKeepLocal={() => undefined}
        onUseOutside={() => undefined}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Changed outside the app" })).toBeTruthy();
    expect(screen.getByText(/Nothing has been overwritten/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep my edits" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use the outside version" })).toBeTruthy();
    expect(screen.queryByText("Sync conflict")).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep mine" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use server" })).toBeNull();
  });
});
