import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDelegatedListItemEvents } from "@/list-item/src/use-delegated-list-item-events";

function DelegatedList({ onItemLongPress }: { onItemLongPress: (id: string) => void }) {
  const { listProps } = useDelegatedListItemEvents({ isTouch: true, onItemLongPress });
  return (
    <div {...listProps}>
      <button type="button" data-list-item-id="note-1">
        Note
      </button>
    </div>
  );
}

describe("useDelegatedListItemEvents", () => {
  it("drops the pending long press when a row reports a swipe", () => {
    vi.useFakeTimers();
    try {
      const onItemLongPress = vi.fn();
      let cancel = () => {};
      function List() {
        const { listProps, cancelPress } = useDelegatedListItemEvents({
          isTouch: true,
          onItemLongPress,
        });
        cancel = cancelPress;
        return (
          <div {...listProps}>
            <button type="button" data-list-item-id="note-1">
              Note
            </button>
          </div>
        );
      }
      const { getByRole } = render(<List />);
      // The swipe library stops touchmove from reaching the list; the row calls cancelPress.
      fireEvent.touchStart(getByRole("button"), { touches: [{ clientX: 200, clientY: 20 }] });
      cancel();
      vi.advanceTimersByTime(600);
      expect(onItemLongPress).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts multi-select on a held touch, but not when the finger swipes sideways", () => {
    vi.useFakeTimers();
    try {
      const onItemLongPress = vi.fn();
      const { getByRole } = render(<DelegatedList onItemLongPress={onItemLongPress} />);
      const row = getByRole("button");

      // A sideways swipe (the row's swipe actions) never becomes a long press.
      fireEvent.touchStart(row, { touches: [{ clientX: 200, clientY: 20 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: 180, clientY: 20 }] });
      vi.advanceTimersByTime(600);
      fireEvent.touchEnd(row);
      expect(onItemLongPress).not.toHaveBeenCalled();

      // A held finger with a little jitter still does.
      fireEvent.touchStart(row, { touches: [{ clientX: 200, clientY: 20 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: 204, clientY: 23 }] });
      vi.advanceTimersByTime(600);
      fireEvent.touchEnd(row);
      expect(onItemLongPress).toHaveBeenCalledWith("note-1");
    } finally {
      vi.useRealTimers();
    }
  });
});
