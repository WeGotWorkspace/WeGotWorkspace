/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNoteCreateWhenReady } from "./use-note-create-when-ready";

describe("useNoteCreateWhenReady", () => {
  it("creates at once when the notebooks are known", () => {
    const createNote = vi.fn();
    const { result } = renderHook(() => useNoteCreateWhenReady(createNote, true));

    result.current.createNote();

    expect(createNote).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(false);
  });

  it("waits for the notebooks, then creates one note for presses made meanwhile", () => {
    const createNote = vi.fn();
    const { result, rerender } = renderHook(
      ({ known }) => useNoteCreateWhenReady(createNote, known),
      { initialProps: { known: false } },
    );

    act(() => {
      result.current.createNote();
      result.current.createNote();
    });
    expect(createNote).not.toHaveBeenCalled();
    // The screen can show that the note is on its way.
    expect(result.current.pending).toBe(true);

    rerender({ known: true });
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(false);

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
