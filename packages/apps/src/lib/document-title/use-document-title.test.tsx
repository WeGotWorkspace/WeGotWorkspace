import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_TITLE_DEBOUNCE_MS,
  useDocumentTitle,
} from "@/lib/document-title/use-document-title";

describe("useDocumentTitle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    document.title = "WeGotWorkspace";
    vi.useRealTimers();
  });

  it("sets document.title from context", () => {
    renderHook(() => useDocumentTitle("Documents"));
    expect(document.title).toBe("Documents | WeGotWorkspace");
  });

  it("restores the previous title on unmount", () => {
    document.title = "Prior title";
    const { unmount } = renderHook(() => useDocumentTitle("Mail"));
    expect(document.title).toBe("Mail | WeGotWorkspace");
    unmount();
    expect(document.title).toBe("Prior title");
  });

  it("updates when context changes", () => {
    const { rerender } = renderHook(({ title }: { title?: string }) => useDocumentTitle(title), {
      initialProps: { title: "Notes" },
    });
    expect(document.title).toBe("Notes | WeGotWorkspace");
    rerender({ title: "My note" });
    expect(document.title).toBe("My note | WeGotWorkspace");
  });

  it("debounces context updates while flushKey stays the same", () => {
    const { rerender } = renderHook(
      ({ title }: { title?: string }) =>
        useDocumentTitle(title, { debounceMs: DOCUMENT_TITLE_DEBOUNCE_MS, flushKey: "note-1" }),
      { initialProps: { title: "Hello" } },
    );
    expect(document.title).toBe("Hello | WeGotWorkspace");

    rerender({ title: "Hello world" });
    expect(document.title).toBe("Hello | WeGotWorkspace");

    vi.advanceTimersByTime(DOCUMENT_TITLE_DEBOUNCE_MS - 1);
    expect(document.title).toBe("Hello | WeGotWorkspace");

    vi.advanceTimersByTime(1);
    expect(document.title).toBe("Hello world | WeGotWorkspace");
  });

  it("applies immediately when flushKey changes", () => {
    const { rerender } = renderHook(
      ({ title, flushKey }: { title?: string; flushKey: string }) =>
        useDocumentTitle(title, { debounceMs: DOCUMENT_TITLE_DEBOUNCE_MS, flushKey }),
      { initialProps: { title: "First note", flushKey: "note-1" } },
    );
    expect(document.title).toBe("First note | WeGotWorkspace");

    rerender({ title: "Second note", flushKey: "note-2" });
    expect(document.title).toBe("Second note | WeGotWorkspace");
  });

  it("resets the debounce timer on rapid context changes", () => {
    const { rerender } = renderHook(
      ({ title }: { title?: string }) =>
        useDocumentTitle(title, { debounceMs: DOCUMENT_TITLE_DEBOUNCE_MS, flushKey: "note-1" }),
      { initialProps: { title: "A" } },
    );

    rerender({ title: "AB" });
    vi.advanceTimersByTime(DOCUMENT_TITLE_DEBOUNCE_MS - 50);
    rerender({ title: "ABC" });
    vi.advanceTimersByTime(DOCUMENT_TITLE_DEBOUNCE_MS - 50);
    expect(document.title).toBe("A | WeGotWorkspace");

    vi.advanceTimersByTime(50);
    expect(document.title).toBe("ABC | WeGotWorkspace");
  });
});
