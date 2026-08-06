import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NoteDetailView } from "@/note-detail-view/src/note-detail-view";

describe("NoteDetailView readOnly", () => {
  it("renders a non-editable contenteditable surface when readOnly", () => {
    const { container } = render(
      <NoteDetailView
        noteId="n-view"
        contentRevision="rev-1"
        tags={["planning"]}
        body={["Shared view-only body"]}
        readOnly
      />,
    );

    const editable = container.querySelector('[contenteditable="true"]');
    expect(editable).toBeNull();

    const locked = container.querySelector('[contenteditable="false"]');
    expect(locked).toBeTruthy();
  });

  it("renders an editable surface when readOnly is false", () => {
    const { container } = render(
      <NoteDetailView
        noteId="n-edit"
        contentRevision="rev-1"
        tags={[]}
        body={["Owner can type"]}
      />,
    );

    expect(container.querySelector('[contenteditable="true"]')).toBeTruthy();
  });
});
