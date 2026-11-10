/** @vitest-environment jsdom */
import { createRef } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceListKeyboardShortcuts } from "@/hooks/use-workspace-list-keyboard-shortcuts";

function renderShortcuts() {
  const onNavigateList = vi.fn();
  renderHook(() =>
    useWorkspaceListKeyboardShortcuts({
      searchInputRef: createRef<HTMLInputElement>(),
      selectedCount: 1,
      onRequestDeleteSelection: vi.fn(),
      onNavigateList,
    }),
  );
  return onNavigateList;
}

function press(target: HTMLElement, key: string, { prevented = false } = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  if (prevented) event.preventDefault();
  target.dispatchEvent(event);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useWorkspaceListKeyboardShortcuts arrow keys", () => {
  it("moves through the list from a plain button", () => {
    const onNavigateList = renderShortcuts();
    const button = document.createElement("button");
    document.body.append(button);
    press(button, "ArrowDown");
    expect(onNavigateList).toHaveBeenCalledWith(1, false);
  });

  it("leaves arrows to a detail dropdown, closed or open", () => {
    const onNavigateList = renderShortcuts();
    // A Radix Select trigger (closed): the arrow opens it.
    const trigger = document.createElement("button");
    trigger.setAttribute("role", "combobox");
    // Its open list (in a portal): the arrow moves between options.
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    const option = document.createElement("div");
    option.setAttribute("role", "option");
    listbox.append(option);
    document.body.append(trigger, listbox);

    press(trigger, "ArrowDown");
    press(option, "ArrowUp");
    expect(onNavigateList).not.toHaveBeenCalled();
  });

  it("leaves an arrow a control already handled", () => {
    const onNavigateList = renderShortcuts();
    const menuItem = document.createElement("div");
    document.body.append(menuItem);
    press(menuItem, "ArrowDown", { prevented: true });
    expect(onNavigateList).not.toHaveBeenCalled();
  });
});
