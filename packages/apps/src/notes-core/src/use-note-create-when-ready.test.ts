/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNoteCreateWhenReady } from "./use-note-create-when-ready";

describe("useNoteCreateWhenReady", () => {
  it("creates at once when the notebooks are known", () => {
    const createNote = vi.fn();
    const { result } = renderHook(() => useNoteCreateWhenReady(createNote, true));

    result.current();

    expect(createNote).toHaveBeenCalledTimes(1);
  });

  it("waits for the notebooks, then creates one note for presses made meanwhile", () => {
    const createNote = vi.fn();
    const { result, rerender } = renderHook(
      ({ known }) => useNoteCreateWhenReady(createNote, known),
      { initialProps: { known: false } },
    );

    result.current();
    result.current();
    expect(createNote).not.toHaveBeenCalled();

    rerender({ known: true });
    expect(createNote).toHaveBeenCalledTimes(1);

    rerender({ known: true });
    expect(createNote).toHaveBeenCalledTimes(1);
  });

  it("creates nothing when nobody pressed before the notebooks loaded", () => {
    const createNote = vi.fn();
    const { rerender } = renderHook(({ known }) => useNoteCreateWhenReady(createNote, known), {
      initialProps: { known: false },
    });

    rerender({ known: true });

    expect(createNote).not.toHaveBeenCalled();
  });
});
