import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import * as Y from "yjs";
import { NoteDetailView } from "@/note-detail-view/src/note-detail-view";
import { NoteCollabYDocProvider } from "@/note-detail-view/src/use-note-title-field";
import {
  noteTitleIsInDoc,
  readNoteTitle,
} from "@/text-editor-core/docs-collab/docs-collab-document-title";

function titleBox(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement;
}

describe("NoteDetailView title in the document", () => {
  it("shows SUMMARY without writing it into the doc", () => {
    const ydoc = new Y.Doc();
    ydoc.getXmlFragment("default");

    render(
      <NoteCollabYDocProvider ydoc={ydoc}>
        <NoteDetailView
          noteId="n-1"
          tags={[]}
          title="Oude titel"
          storedTitle="Oude titel"
          body={["# Other", "Notes"]}
          onTitleChange={vi.fn()}
        />
      </NoteCollabYDocProvider>,
    );

    expect(noteTitleIsInDoc(ydoc)).toBe(false);
    expect(titleBox().value).toBe("Oude titel");
  });

  it("writes a real edit whole, without splicing the stored summary", () => {
    const ydoc = new Y.Doc();
    const onTitleChange = vi.fn();

    render(
      <NoteCollabYDocProvider ydoc={ydoc}>
        <NoteDetailView
          noteId="n-1"
          tags={[]}
          title="Oude titel"
          storedTitle="Oude titel"
          body={[""]}
          onTitleChange={onTitleChange}
        />
      </NoteCollabYDocProvider>,
    );

    fireEvent.change(titleBox(), { target: { value: "Nieuwe titel" } });

    expect(readNoteTitle(ydoc)).toBe("Nieuwe titel");
    expect(readNoteTitle(ydoc)).not.toBe("Oude titelel");
    expect(onTitleChange).toHaveBeenCalledWith("Nieuwe titel");
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

    fireEvent.change(titleBox(), { target: { value: "Event" } });

    expect(readNoteTitle(ydoc)).toBe("Event");
    expect(onTitleChange).toHaveBeenCalledWith("Event");
  });
});
