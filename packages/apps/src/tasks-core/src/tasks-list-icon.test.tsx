import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskListIcon } from "@/tasks-core/src/tasks-list-icon";
import { INBOX_TASK_LIST_ID, taskListDotColor } from "@/tasks-core/src/tasks-task-utils";

describe("TaskListIcon", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a decorative list glyph, not a rounded swatch", () => {
    const { container } = render(<TaskListIcon list={{ id: INBOX_TASK_LIST_ID }} />);
    const icon = container.querySelector(".tasks-list-icon");
    expect(icon).toBeTruthy();
    expect(icon?.tagName.toLowerCase()).toBe("svg");
    expect(icon?.getAttribute("class") ?? "").not.toMatch(/rounded-full/);
    expect(container.querySelector(".tasks-list-dot")).toBeNull();
  });

  it("tints the owned inbox glyph from the hashed list color", () => {
    const { container } = render(<TaskListIcon list={{ id: INBOX_TASK_LIST_ID }} />);
    const icon = container.querySelector(".tasks-list-icon") as HTMLElement | null;
    expect(icon?.style.getPropertyValue("--collection-row-color")).toBe(
      taskListDotColor({ id: INBOX_TASK_LIST_ID }),
    );
  });

  it("tints a renamed inbox list the same way", () => {
    const { container } = render(<TaskListIcon list={{ id: "tl-inbox-uuid" }} />);
    const icon = container.querySelector(".tasks-list-icon") as HTMLElement | null;
    expect(icon).toBeTruthy();
    expect(icon?.style.getPropertyValue("--collection-row-color")).toBe(
      taskListDotColor({ id: "tl-inbox-uuid" }),
    );
  });

  it("uses the explicit list color when present", () => {
    const { container } = render(<TaskListIcon list={{ id: "work", color: "#ff0000" }} />);
    const icon = container.querySelector(".tasks-list-icon") as HTMLElement | null;
    expect(icon?.style.getPropertyValue("--collection-row-color")).toBe("#ff0000");
  });
});
