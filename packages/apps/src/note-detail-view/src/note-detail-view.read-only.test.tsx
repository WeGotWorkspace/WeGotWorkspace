import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("omits the tag group when showTags is false", () => {
    const { container } = render(
      <NoteDetailView
        noteId="n-shared"
        contentRevision="rev-1"
        tags={["hidden"]}
        body={["Shared body"]}
        showTags={false}
      />,
    );

    expect(container.querySelector(".note-detail-view__tag-group")).toBeNull();
    expect(container.querySelector(".tag-group")).toBeNull();
  });

  it("exposes a first-class title field that the user can edit", () => {
    const onTitleChange = vi.fn();
    render(
      <NoteDetailView
        noteId="n-title"
        contentRevision="rev-1"
        title="Meeting"
        onTitleChange={onTitleChange}
        tags={[]}
        body={["Notes"]}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement;
    expect(input.value).toBe("Meeting");
    expect(input.classList.contains("note-detail-view__title")).toBe(true);
    expect(document.querySelector(`label[for="${input.id}"]`)).toBeTruthy();
    fireEvent.change(input, { target: { value: "Kept" } });
    expect(onTitleChange).toHaveBeenCalledWith("Kept");
  });

  it("locks the title field when readOnly", () => {
    render(
      <NoteDetailView
        noteId="n-title-ro"
        contentRevision="rev-1"
        title="Locked"
        onTitleChange={() => {}}
        tags={[]}
        body={["Notes"]}
        readOnly
      />,
    );
    const input = screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
  });
});
