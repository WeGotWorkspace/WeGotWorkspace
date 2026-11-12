import { describe, expect, it } from "vitest";
import {
  SWIPEABLE_LIST_INJECTED_PROPS,
  workspaceListRowPropsEqual,
} from "./workspace-list-row-props";

const onToggle = () => {};
const note = { id: "n-1" };

describe("workspaceListRowPropsEqual", () => {
  it("ignores the props SwipeableList injects", () => {
    // What SwipeableList.render passes to every child, new on every render.
    const injected = (index: number) => ({
      actionDelay: 0,
      destructiveCallbackDelay: 1000,
      fullSwipe: true,
      listType: index,
      optOutMouseEvents: false,
      scrollStartThreshold: undefined,
      swipeStartThreshold: undefined,
      threshold: 0.5,
      clickedCallback: () => {},
      id: `listItem-${index}`,
      resetState: () => {},
    });
    expect(Object.keys(injected(0)).sort()).toEqual([...SWIPEABLE_LIST_INJECTED_PROPS].sort());
    expect(
      workspaceListRowPropsEqual(
        { note, starred: true, onToggle, ...injected(3) },
        { note, starred: true, onToggle, ...injected(7) },
      ),
    ).toBe(true);
  });

  it("sees a change in the row's own props", () => {
    expect(workspaceListRowPropsEqual({ note, starred: true }, { note, starred: false })).toBe(
      false,
    );
    expect(workspaceListRowPropsEqual({ note }, { note: { id: "n-1" } })).toBe(false);
    expect(workspaceListRowPropsEqual({ note, onToggle }, { note, onToggle: () => {} })).toBe(
      false,
    );
  });

  it("sees a prop that appears or disappears", () => {
    expect(workspaceListRowPropsEqual({ note }, { note, pending: undefined })).toBe(false);
    expect(workspaceListRowPropsEqual({ note, pending: undefined }, { note })).toBe(false);
  });
});
