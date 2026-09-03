import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareRowSelect } from "./share-row-select";

afterEach(() => {
  cleanup();
});

describe("ShareRowSelect", () => {
  it("defaults to the md trigger size", () => {
    const { container } = render(
      <ShareRowSelect
        value="edit"
        options={[{ value: "edit", label: "Can edit" }]}
        aria-label="Permission"
        onChange={vi.fn()}
      />,
    );
    const trigger = container.querySelector(".select-trigger");
    expect(trigger).not.toBeNull();
    expect(trigger!.classList.contains("select-trigger--size-sm")).toBe(false);
  });

  it("applies the compact size class when size is sm", () => {
    const { container } = render(
      <ShareRowSelect
        value="edit"
        options={[{ value: "edit", label: "Can edit" }]}
        aria-label="Permission"
        size="sm"
        className="contacts-detail-view__context-select"
        onChange={vi.fn()}
      />,
    );
    const trigger = container.querySelector(".select-trigger");
    expect(trigger).not.toBeNull();
    expect(trigger!.classList.contains("select-trigger--size-sm")).toBe(true);
    expect(trigger!.classList.contains("contacts-detail-view__context-select")).toBe(true);
  });

  it("keeps share-dialog item type only on the default trigger", () => {
    const { rerender } = render(
      <ShareRowSelect
        value="edit"
        options={[{ value: "edit", label: "Can edit" }]}
        aria-label="Permission"
        onChange={vi.fn()}
      />,
    );
    expect(document.querySelector(".share-dialog__permission-item")).not.toBeNull();

    rerender(
      <ShareRowSelect
        value="home"
        options={[{ value: "home", label: "Home" }]}
        aria-label="Type"
        className="contacts-detail-view__context-select"
        itemClassName="contacts-detail-view__context-select-item"
        onChange={vi.fn()}
      />,
    );
    expect(document.querySelector(".share-dialog__permission-item")).toBeNull();
    expect(document.querySelector(".contacts-detail-view__context-select-item")).not.toBeNull();
  });
});
