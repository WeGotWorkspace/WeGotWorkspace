import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { NotesRenameTagDialog } from "@/notes-core/src/notes-rename-tag-dialog";
import { TooltipProvider } from "@/ui/tooltip";

function renderDialog(overrides: Partial<ComponentProps<typeof NotesRenameTagDialog>> = {}) {
  const onRename = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <TooltipProvider delayDuration={0}>
      <NotesRenameTagDialog
        open
        tag="focus"
        existingTags={["focus", "reading"]}
        labels={defaultNotesLabels}
        onClose={onClose}
        onRename={onRename}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onRename, onClose, ...view };
}

describe("NotesRenameTagDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("seeds the input with the current tag and keeps confirm disabled until it changes", () => {
    renderDialog();
    const input = screen.getByRole("textbox", { name: "Tag name" });
    expect((input as HTMLInputElement).value).toBe("focus");
    const confirm = screen.getByRole("button", { name: "Rename" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(input.getAttribute("aria-invalid")).not.toBe("true");

    fireEvent.change(input, { target: { value: "reading" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables confirm and shows the charset hint for an invalid draft", () => {
    renderDialog();
    fireEvent.change(screen.getByRole("textbox", { name: "Tag name" }), {
      target: { value: "Foo Bar" },
    });
    expect((screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const hint = screen.getByText(defaultNotesLabels.tagCharsetHint);
    const input = screen.getByRole("textbox", { name: "Tag name" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(hint.getAttribute("id")).toEqual(expect.any(String));
    expect(input.getAttribute("aria-describedby")).toBe(hint.getAttribute("id"));
  });

  it("shows the merge hint when the draft is an existing tag", () => {
    renderDialog();
    expect(screen.queryByText(/already exists/)).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Tag name" }), {
      target: { value: "reading" },
    });
    const hint = screen.getByText("“reading” already exists. The two tags will be merged.");
    const input = screen.getByRole("textbox", { name: "Tag name" });
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
    expect(hint.getAttribute("id")).toEqual(expect.any(String));
    expect(input.getAttribute("aria-describedby")).toBe(hint.getAttribute("id"));
  });

  it("does not rename when Cancel closes a dirty draft", () => {
    const { onRename, onClose } = renderDialog();
    fireEvent.change(screen.getByRole("textbox", { name: "Tag name" }), {
      target: { value: "reading" },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultNotesLabels.dialogCancel }));
    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
