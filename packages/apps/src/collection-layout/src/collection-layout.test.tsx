/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectionListWorkspace } from "@/collection-layout/src/collection-layout";

afterEach(cleanup);

const dropZone = {
  active: false,
  overlay: null,
  onDragOver: vi.fn(),
  onDragLeave: vi.fn(),
  onDrop: vi.fn(),
};

function Workspace({ withDropZone }: { withDropZone: boolean }) {
  return (
    <CollectionListWorkspace
      header={null}
      listContent={<div style={{ height: 10_000 }} />}
      hasItems
      emptyLabel="Empty"
      dropZone={withDropZone ? dropZone : undefined}
    />
  );
}

describe("CollectionListWorkspace", () => {
  it("keeps the scroller and its scroll position when the drop zone turns on", () => {
    // Contacts first visit: import unlocks after the cold download, which adds
    // the drop zone while the user may already be scrolling the list.
    const { container, rerender } = render(<Workspace withDropZone={false} />);
    const scroller = container.querySelector<HTMLElement>(".notes-swipe-list");
    if (!scroller) throw new Error("scroller missing");
    scroller.scrollTop = 4000;

    rerender(<Workspace withDropZone />);

    const after = container.querySelector<HTMLElement>(".notes-swipe-list");
    expect(after).toBe(scroller);
    expect(after?.scrollTop).toBe(4000);
    expect(container.querySelector(".collection-list-drop-zone")).toBeTruthy();
  });

  it("keeps the scroller when the drop zone turns off", () => {
    const { container, rerender } = render(<Workspace withDropZone />);
    const scroller = container.querySelector<HTMLElement>(".notes-swipe-list");

    rerender(<Workspace withDropZone={false} />);

    expect(container.querySelector(".notes-swipe-list")).toBe(scroller);
    expect(container.querySelector(".collection-list-drop-zone")).toBeNull();
  });
});
