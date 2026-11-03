import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  NoteCollabYDocProvider,
  useNoteTitleField,
} from "@/note-detail-view/src/use-note-title-field";

describe("useNoteTitleField", () => {
  it("saves a title typed while the note has no document", () => {
    const onTitleChange = vi.fn();
    const onTitleEdit = vi.fn();
    const { result } = renderHook(() =>
      useNoteTitleField({ title: "", readOnly: false, onTitleChange, onTitleEdit }),
    );

    act(() => result.current.onChange?.("Ha"));

    expect(onTitleEdit).toHaveBeenCalledWith("Ha");
    expect(onTitleChange).not.toHaveBeenCalled();
  });

  it("writes the document, not the metadata save, once a document is open", () => {
    const ydoc = new Y.Doc();
    const onTitleEdit = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NoteCollabYDocProvider ydoc={ydoc}>{children}</NoteCollabYDocProvider>
    );
    const { result } = renderHook(
      () => useNoteTitleField({ title: "", readOnly: false, onTitleChange: vi.fn(), onTitleEdit }),
      { wrapper },
    );

    act(() => result.current.onChange?.("Ha"));

    expect(onTitleEdit).not.toHaveBeenCalled();
  });
});
