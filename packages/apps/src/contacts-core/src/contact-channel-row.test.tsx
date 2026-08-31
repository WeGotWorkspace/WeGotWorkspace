import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { ContactChannelRow } from "./contact-channel-row";

afterEach(() => {
  cleanup();
});

function renderRow(props: Partial<ComponentProps<typeof ContactChannelRow>> = {}) {
  const onRemove = props.onRemove === undefined ? vi.fn() : props.onRemove;
  return {
    onRemove,
    ...render(
      <TooltipProvider delayDuration={0}>
        <ContactChannelRow
          typeControl={<span>Work</span>}
          removeLabel="Remove"
          onRemove={onRemove}
          {...props}
        >
          {props.children ?? <input aria-label="Phone number" defaultValue="555" />}
        </ContactChannelRow>
      </TooltipProvider>,
    ),
  };
}

describe("ContactChannelRow", () => {
  it("renders the type control, value slot, and accessible remove", () => {
    renderRow();
    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.getByLabelText("Phone number")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  it("calls onRemove from the remove control", () => {
    const { onRemove } = renderRow();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("marks address rows for end-aligned top-row layout", () => {
    const { container } = renderRow({
      variant: "address",
      children: <div>Street fields</div>,
    });
    expect(container.querySelector(".contacts-detail-view__channel-row--address")).toBeTruthy();
    expect(container.querySelector(".contacts-detail-view__address-remove")).toBeTruthy();
  });

  it("reserves an inert action column on the trailing empty slot", () => {
    const { container } = renderRow({ onRemove: undefined, removeLabel: undefined });
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(container.querySelector(".contacts-detail-view__channel-action")).toBeTruthy();
    expect(container.querySelector(".contacts-detail-view__channel-action-spacer")).toBeTruthy();
  });

  it("keeps the action column on filled rows", () => {
    const { container } = renderRow();
    expect(container.querySelector(".contacts-detail-view__channel-action")).toBeTruthy();
    expect(container.querySelector(".contacts-detail-view__channel-action-spacer")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });
});
