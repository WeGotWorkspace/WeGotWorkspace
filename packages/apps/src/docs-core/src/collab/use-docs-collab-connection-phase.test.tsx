import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_PHASE_REVEAL_MS } from "./docs-collab-connection-phase";
import { useDocsCollabConnectionPhase } from "./use-docs-collab-connection-phase";

describe("useDocsCollabConnectionPhase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it("says nothing while no phase is active", () => {
    const { result } = renderHook(() => useDocsCollabConnectionPhase(null));
    advance(CONNECTION_PHASE_REVEAL_MS * 2);
    expect(result.current).toBeNull();
  });

  it("stays silent until the phase has lasted 1.5 seconds", () => {
    const { result } = renderHook(() => useDocsCollabConnectionPhase("connecting"));

    expect(result.current).toBeNull();
    advance(CONNECTION_PHASE_REVEAL_MS - 1);
    expect(result.current).toBeNull();
    advance(1);
    expect(result.current).toBe("connecting");
  });

  it("never announces a reconnect that resolves inside the window", () => {
    const { result, rerender } = renderHook(
      ({ phase }: { phase: "reconnecting" | null }) => useDocsCollabConnectionPhase(phase),
      { initialProps: { phase: "reconnecting" as "reconnecting" | null } },
    );

    advance(1_400);
    expect(result.current).toBeNull();

    rerender({ phase: null });
    advance(CONNECTION_PHASE_REVEAL_MS * 2);
    expect(result.current).toBeNull();
  });

  it("clears the moment the phase ends, even after it was revealed", () => {
    const { result, rerender } = renderHook(
      ({ phase }: { phase: "connecting" | null }) => useDocsCollabConnectionPhase(phase),
      { initialProps: { phase: "connecting" as "connecting" | null } },
    );

    advance(CONNECTION_PHASE_REVEAL_MS);
    expect(result.current).toBe("connecting");

    rerender({ phase: null });
    expect(result.current).toBeNull();
  });

  it("restarts the hold when one phase gives way to another", () => {
    const { result, rerender } = renderHook(
      ({ phase }: { phase: "connecting" | "reconnecting" }) => useDocsCollabConnectionPhase(phase),
      { initialProps: { phase: "connecting" as "connecting" | "reconnecting" } },
    );

    advance(CONNECTION_PHASE_REVEAL_MS - 100);
    rerender({ phase: "reconnecting" });

    advance(CONNECTION_PHASE_REVEAL_MS - 1);
    expect(result.current).toBeNull();
    advance(1);
    expect(result.current).toBe("reconnecting");
  });
});
