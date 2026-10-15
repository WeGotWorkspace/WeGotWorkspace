import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defaultNotesLabels } from "./notes-labels";
import { NotesExternalWriteDialog } from "./notes-external-write-dialog";

describe("NotesExternalWriteDialog", () => {
  it("tells the person the note changed outside the app", () => {
    render(
      <NotesExternalWriteDialog
        open
        noteTitle="Shopping"
        labels={defaultNotesLabels}
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
