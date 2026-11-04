import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOfflinePendingToast, useOfflineSyncToast } from "@/lib/offline/use-offline-sync-toast";

const show = vi.fn();
const online = vi.hoisted(() => ({ value: true }));

vi.mock("@/hooks/use-app-toast", () => ({ useAppToast: () => ({ show }) }));
vi.mock("@/lib/offline/core/browser-online", () => ({
  getConnectivitySnapshot: () => online.value,
}));

// "Changes synced" only once changes reached the server (#1563).
describe("useOfflineSyncToast", () => {
  beforeEach(() => {
    show.mockReset();
    online.value = true;
  });

  it("toasts when a sync cycle finishes online", () => {
    const { rerender } = renderHook(({ syncing }) => useOfflineSyncToast(syncing, "Synced"), {
      initialProps: { syncing: true },
    });
    rerender({ syncing: false });
    expect(show).toHaveBeenCalledOnce();
  });

  it("stays quiet when the tab is offline again by the time it finishes", () => {
    const { rerender } = renderHook(({ syncing }) => useOfflineSyncToast(syncing, "Synced"), {
      initialProps: { syncing: true },
    });
    online.value = false;
    rerender({ syncing: false });
    expect(show).not.toHaveBeenCalled();
  });

  it("stays quiet when nothing of the cycle landed", () => {
    let landed = false;
    const { rerender } = renderHook(
      ({ syncing }) => useOfflineSyncToast(syncing, "Synced", () => landed),
      { initialProps: { syncing: true } },
    );
    rerender({ syncing: false });
    expect(show).not.toHaveBeenCalled();

    landed = true;
    rerender({ syncing: true });
    rerender({ syncing: false });
    expect(show).toHaveBeenCalledOnce();
  });
});

describe("useOfflinePendingToast", () => {
  beforeEach(() => {
    show.mockReset();
    online.value = true;
  });

  it("toasts when the open document's pending save clears online", () => {
    const { rerender } = renderHook(
      ({ pending }) => useOfflinePendingToast(pending, "Synced", true, "doc-a"),
      { initialProps: { pending: true } },
    );
    rerender({ pending: false });
    expect(show).toHaveBeenCalledOnce();
  });

  it("stays quiet when the flag clears offline", () => {
    const { rerender } = renderHook(
      ({ pending }) => useOfflinePendingToast(pending, "Synced", true, "doc-a"),
      { initialProps: { pending: true } },
    );
    online.value = false;
    rerender({ pending: false });
    expect(show).not.toHaveBeenCalled();
  });

  it("stays quiet when the editor moved to another document", () => {
    const { rerender } = renderHook(
      ({ pending, key }) => useOfflinePendingToast(pending, "Synced", true, key),
      { initialProps: { pending: true, key: "doc-a" } },
    );
    rerender({ pending: false, key: "doc-b" });
    expect(show).not.toHaveBeenCalled();
  });
});
