/** @vitest-environment jsdom */
import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { DocsConflictDialog } from "./docs-conflict-dialog";
import { useDocsConflictResolution } from "./use-docs-conflict-resolution";

describe("useDocsConflictResolution document gone", () => {
  it("reuses the conflict dialog and keeps the local copy on both actions", () => {
    const saveNow = vi.fn(async () => undefined);
    const onServerApplied = vi.fn();
    const { result } = renderHook(() =>
      useDocsConflictResolution({
        room: "users/ada/gone.md",
        ydoc: null,
        yjsUrl: "/yjs",
        authToken: "token",
        saveNow,
        onServerApplied,
      }),
    );

    act(() => {
      result.current.reportDocumentGone();
    });
    expect(result.current.open).toBe(true);
    expect(result.current.mode).toBe("gone");

    render(
      <DocsConflictDialog
        open
        documentTitle="gone.md"
        labels={{
          conflictTitle: docsLabels.documentGoneTitle,
          conflictDescription: () => docsLabels.documentGoneDescription,
          conflictKeepMine: docsLabels.documentGoneKeep,
          conflictUseServer: docsLabels.documentGoneClose,
        }}
        onKeepLocal={result.current.keepLocal}
        onUseServer={result.current.useServer}
      />,
    );

    expect(screen.getByText(docsLabels.documentGoneTitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: docsLabels.documentGoneKeep })).toBeTruthy();
    expect(screen.getByRole("button", { name: docsLabels.documentGoneClose })).toBeTruthy();

    act(() => {
      result.current.keepLocal();
    });
    expect(saveNow).not.toHaveBeenCalled();
    expect(onServerApplied).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);

    act(() => {
      result.current.reportDocumentGone();
    });
    act(() => {
      result.current.useServer();
    });
    expect(saveNow).not.toHaveBeenCalled();
    expect(onServerApplied).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
  });
});
