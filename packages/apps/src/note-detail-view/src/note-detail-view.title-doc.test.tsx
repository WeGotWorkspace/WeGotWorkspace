import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import * as Y from "yjs";
import { NoteDetailView } from "@/note-detail-view/src/note-detail-view";
import { NoteCollabYDocProvider } from "@/note-detail-view/src/use-note-title-field";
import { readNoteTitle } from "@/notes-core/src/note-title-doc";

describe("NoteDetailView title in the document", () => {
  it("seeds SUMMARY into a doc that has no title yet", () => {
    const ydoc = new Y.Doc();
    ydoc.getXmlFragment("default");

    render(
      <NoteCollabYDocProvider ydoc={ydoc}>
        <NoteDetailView
          noteId="n-1"
          tags={[]}
          title="Event"
          storedTitle="Event"
          body={["# Other", "Notes"]}
          onTitleChange={vi.fn()}
        />
      </NoteCollabYDocProvider>,
    );

    expect(readNoteTitle(ydoc)).toBe("Event");
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toBe(
      "Event",
    );
  });

  it("writes the title field into the Y.Text", () => {
    const ydoc = new Y.Doc();
    const onTitleChange = vi.fn();

    render(
      <NoteCollabYDocProvider ydoc={ydoc}>
        <NoteDetailView
          noteId="n-1"
          tags={[]}
          title=""
          storedTitle={null}
          body={[""]}
          onTitleChange={onTitleChange}
        />
      </NoteCollabYDocProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Event" },
    });

    expect(readNoteTitle(ydoc)).toBe("Event");
    expect(onTitleChange).toHaveBeenCalledWith("Event");
  });
});
