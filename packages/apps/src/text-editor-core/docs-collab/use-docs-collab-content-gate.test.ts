/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  DOCS_COLLAB_CONTENT_WAIT_MS,
  expectsServerContent,
  useDocsCollabContentGate,
} from "./use-docs-collab-content-gate";

function fillDoc(ydoc: Y.Doc) {
  ydoc.getXmlFragment("default").insert(0, [new Y.XmlElement("paragraph")]);
}

describe("useDocsCollabContentGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases once the document gets content, e.g. from a peer", () => {
    const ydoc = new Y.Doc();
    const release = vi.fn();
    renderHook(() => useDocsCollabContentGate(ydoc, true, release));
    expect(release).not.toHaveBeenCalled();

    fillDoc(ydoc);

    expect(release).toHaveBeenCalled();
  });

  it("releases at once when the document already has content", () => {
    const ydoc = new Y.Doc();
    fillDoc(ydoc);
    const release = vi.fn();
    renderHook(() => useDocsCollabContentGate(ydoc, true, release));

    expect(release).toHaveBeenCalled();
  });

  it("releases after the longest wait when no content comes", () => {
    const ydoc = new Y.Doc();
    const release = vi.fn();
    renderHook(() => useDocsCollabContentGate(ydoc, true, release));

    vi.advanceTimersByTime(DOCS_COLLAB_CONTENT_WAIT_MS - 1);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases when a check answers that no content is expected after all", () => {
    const ydoc = new Y.Doc();
    const release = vi.fn();
    const hook = renderHook(
      ({ untilChecked }: { untilChecked: boolean }) =>
        useDocsCollabContentGate(ydoc, true, release, {
          roomNotPersistent: true,
          roomHeldUntilChecked: untilChecked,
        }),
      { initialProps: { untilChecked: true } },
    );
    expect(release).not.toHaveBeenCalled();

    hook.rerender({ untilChecked: false });

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does nothing while nothing is awaited", () => {
    const ydoc = new Y.Doc();
    const release = vi.fn();
    renderHook(() => useDocsCollabContentGate(ydoc, false, release));

    fillDoc(ydoc);
    vi.advanceTimersByTime(DOCS_COLLAB_CONTENT_WAIT_MS);

    expect(release).not.toHaveBeenCalled();
  });
});

describe("expectsServerContent", () => {
  it("waits for a room on the server, and for one held only until a check answers", () => {
    expect(expectsServerContent({})).toBe(true);
    expect(expectsServerContent({ roomNotPersistent: true, roomHeldUntilChecked: true })).toBe(
      true,
    );
  });

  it("does not wait for a room whose server copy does not exist yet", () => {
    expect(expectsServerContent({ roomNotPersistent: true })).toBe(false);
    expect(expectsServerContent({ roomNotPersistent: true, roomHeldUntilChecked: false })).toBe(
      false,
    );
  });
});
