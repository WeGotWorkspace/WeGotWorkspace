import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/ui/tooltip";
import { NoteDetailView } from "@/note-detail-view/src/note-detail-view";

function renderDetail(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

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

  it("wraps title, tags, and editor in a paper sheet", () => {
    const { container } = renderDetail(
      <NoteDetailView
        noteId="n-sheet"
        contentRevision="rev-1"
        title="Paper"
        onTitleChange={() => {}}
        tags={["travel"]}
        onTagAdd={() => {}}
        onTagRemove={() => {}}
        body={["Body"]}
      />,
    );

    const sheet = container.querySelector(".note-detail-sheet");
    expect(sheet).toBeTruthy();
    expect(sheet!.classList.contains("note-detail-view")).toBe(true);
    expect(sheet!.querySelector(".note-detail-view__title")).toBeTruthy();
    expect(sheet!.querySelector(".note-detail-view__tag-group")).toBeTruthy();
    expect(sheet!.querySelector(".note-text-editor-body")).toBeTruthy();
    expect(sheet!.querySelector(".notes-detail-footer")).toBeNull();
  });

  it("exposes a first-class wrapping title textarea that the user can edit", () => {
    const onTitleChange = vi.fn();
    const longTitle =
      "Typography going along a long wrapping note title that should not stay on one line";
    render(
      <NoteDetailView
        noteId="n-title"
        contentRevision="rev-1"
        title={longTitle}
        onTitleChange={onTitleChange}
        tags={[]}
        body={["Notes"]}
      />,
    );
    const title = screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement;
    expect(title.tagName).toBe("TEXTAREA");
    expect(title.value).toBe(longTitle);
    expect(title.classList.contains("note-detail-view__title")).toBe(true);
    expect(title.wrap).toBe("soft");
    expect(title.rows).toBe(1);
    expect(title.className).not.toMatch(/truncate|line-clamp|whitespace-nowrap/);
    expect(document.querySelector(`label[for="${title.id}"]`)).toBeTruthy();
    fireEvent.change(title, { target: { value: "Kept" } });
    expect(onTitleChange).toHaveBeenCalledWith("Kept");
  });

  it("moves focus to the body when Enter is pressed in the title", () => {
    render(
      <NoteDetailView
        noteId="n-title-enter"
        contentRevision="rev-1"
        title="Going"
        onTitleChange={() => {}}
        tags={[]}
        body={["Notes"]}
      />,
    );
    const title = screen.getByRole("textbox", { name: "Title" });
    const body = document.querySelector<HTMLElement>(
      ".note-text-editor-body [contenteditable='true']",
    );
    expect(body).toBeTruthy();
    title.focus();
    fireEvent.keyDown(title, { key: "Enter" });
    expect(document.activeElement).toBe(body);
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
    const title = screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement;
    expect(title.tagName).toBe("TEXTAREA");
    expect(title.readOnly).toBe(true);
  });

  it("calls onTagRemove when a detail-pane chip X is clicked", () => {
    const onTagRemove = vi.fn();
    renderDetail(
      <NoteDetailView
        noteId="n-tags"
        contentRevision="rev-1"
        title="Tagged"
        onTitleChange={() => {}}
        tags={["planning", "draft"]}
        availableTags={["planning", "draft"]}
        onTagAdd={() => {}}
        onTagRemove={onTagRemove}
        body={["Notes"]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove tag planning" }));
    expect(onTagRemove).toHaveBeenCalledTimes(1);
    expect(onTagRemove).toHaveBeenCalledWith("planning");
  });
});
