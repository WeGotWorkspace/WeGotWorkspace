import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_PHASE_REVEAL_MS } from "./docs-collab-connection-phase";
import {
  useDocsCollabStatusIndicator,
  type UseDocsCollabStatusIndicatorOptions,
} from "./use-docs-collab-status-indicator";

const base: UseDocsCollabStatusIndicatorOptions = {
  docStatus: "",
  online: true,
  pendingSync: false,
  failedSync: false,
  unreachableCount: 0,
};

function renderIndicator(overrides: Partial<UseDocsCollabStatusIndicatorOptions> = {}) {
  return renderHook(
    (options: UseDocsCollabStatusIndicatorOptions) => useDocsCollabStatusIndicator(options),
    { initialProps: { ...base, ...overrides } },
  );
}

describe("useDocsCollabStatusIndicator", () => {
  it("shows the saving state while edits are still local", () => {
    const { result } = renderIndicator({ pendingSync: true });
    expect(result.current).toEqual({ kind: "saving", label: "Saving…" });
  });

  it("does not claim to be saving once the save has failed", () => {
    const { result } = renderIndicator({ pendingSync: true, failedSync: true });
    expect(result.current.kind).not.toBe("saving");
  });

  it("shows the offline state", () => {
    const { result } = renderIndicator({ online: false });
    expect(result.current).toEqual({
      kind: "offline",
      label: "Offline – changes are kept on this device",
    });
  });

  it("shows the save-only state when someone cannot be reached directly", () => {
    const { result } = renderIndicator({ unreachableCount: 1 });
    expect(result.current).toEqual({ kind: "saveOnly", label: "Changes sync when saved" });
  });

  it("passes an unmodelled docStatus straight through rather than hiding it", () => {
    const { result } = renderIndicator({ docStatus: "Could not load the shared copy. Retrying…" });
    expect(result.current).toEqual({
      kind: "message",
      label: "Could not load the shared copy. Retrying…",
    });
  });

  it("renders nothing at all when there is no story to tell", () => {
    const { result } = renderIndicator();
    expect(result.current).toEqual({ kind: "idle", label: "" });
    expect(result.current.label).not.toMatch(/Live with/);
    expect(result.current.label).not.toBe("Saved");
  });
});

describe("useDocsCollabStatusIndicator transient debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides a connecting phase until it has lasted 1.5 seconds", () => {
    const { result } = renderIndicator({ docStatus: "Connecting to collaborators…" });

    expect(result.current.kind).toBe("idle");
    act(() => void vi.advanceTimersByTime(CONNECTION_PHASE_REVEAL_MS - 1));
    expect(result.current.kind).toBe("idle");

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ kind: "connecting", label: "Connecting…" });
  });

  it("never announces a reconnect that resolves inside the window", () => {
    const { result, rerender } = renderIndicator({
      docStatus: "Reconnecting…",
    });

    // The reader keeps seeing the calm underlying state throughout.
    act(() => void vi.advanceTimersByTime(1_400));
    expect(result.current).toEqual({ kind: "idle", label: "" });

    rerender({ ...base, docStatus: "" });
    act(() => void vi.advanceTimersByTime(CONNECTION_PHASE_REVEAL_MS * 2));
    expect(result.current).toEqual({ kind: "idle", label: "" });
  });

  it("lets offline outrank even a revealed phase", () => {
    const { result } = renderIndicator({ docStatus: "Reconnecting…", online: false });

    act(() => void vi.advanceTimersByTime(CONNECTION_PHASE_REVEAL_MS));
    expect(result.current.kind).toBe("offline");
  });
});
