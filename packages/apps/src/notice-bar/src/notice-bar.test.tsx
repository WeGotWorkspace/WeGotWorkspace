import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoticeBar, type ActionNotice } from "@/notice-bar/src/notice-bar";

const notice = (id: string, title: string, onAction = vi.fn()): ActionNotice => ({
  id,
  title,
  actionLabel: `Act on ${id}`,
  onAction,
});

describe("NoticeBar", () => {
  it("renders nothing when no notice waits", () => {
    const { container } = render(
      <NoticeBar label="Needs your attention" notices={[null, undefined]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("stacks the notices in the given order, skipping empty ones", () => {
    render(
      <NoticeBar
        label="Needs your attention"
        notices={[
          notice("sync", "Some changes could not sync."),
          null,
          notice("rescue", "Tasks need a list."),
        ]}
      />,
    );
    const bar = screen.getByRole("region", { name: "Needs your attention" });
    expect(bar.getAttribute("aria-live")).toBe("polite");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Act on sync",
      "Act on rescue",
    ]);
  });

  it("runs the action and has no way to dismiss", () => {
    const onAction = vi.fn();
    render(
      <NoticeBar
        label="Needs your attention"
        notices={[notice("rescue", "Tasks need a list.", onAction)]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Act on rescue" }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("disables the action while it runs", () => {
    render(
      <NoticeBar
        label="Needs your attention"
        notices={[{ ...notice("sync", "Some changes could not sync."), actionDisabled: true }]}
      />,
    );
    expect(screen.getByRole("button", { name: "Act on sync" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows an info notice without an action", () => {
    render(
      <NoticeBar
        label="Needs your attention"
        notices={[{ id: "offline", tone: "info", title: "Offline · data updated 5 minutes ago." }]}
      />,
    );
    expect(screen.getByText("Offline · data updated 5 minutes ago.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
