import type { ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  BooleanSegmentedControl,
  SegmentedControl,
} from "@/segmented-control/src/segmented-control";
import { TooltipProvider } from "@/ui/tooltip";

const options = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
] as const;

const iconOptions = [
  { value: "grid", label: "Grid view", icon: <span data-testid="grid-icon" /> },
  { value: "list", label: "List view", icon: <span data-testid="list-icon" /> },
] as const;

const rsvpOptions = [
  {
    value: "accepted",
    label: "Accept",
    icon: <span data-testid="accept-icon" />,
    severity: "success" as const,
  },
  { value: "tentative", label: "Maybe", icon: <span data-testid="maybe-icon" /> },
  {
    value: "declined",
    label: "Decline",
    icon: <span data-testid="decline-icon" />,
    severity: "danger" as const,
  },
];

function renderWithTooltip(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("SegmentedControl", () => {
  it("defaults to md height with the md size modifier class", () => {
    const { container } = render(
      <SegmentedControl value="grid" onChange={vi.fn()} options={[...options]} />,
    );
    const root = container.querySelector(".segmented-control");
    expect(root).not.toBeNull();
    expect(root!.classList.contains("segmented-control--size-md")).toBe(true);
    expect(root!.classList.contains("segmented-control--size-lg")).toBe(false);
  });

  it("applies the lg size modifier when requested", () => {
    const { container } = render(
      <SegmentedControl value="grid" onChange={vi.fn()} options={[...options]} size="lg" />,
    );
    const root = container.querySelector(".segmented-control");
    expect(root).not.toBeNull();
    expect(root!.classList.contains("segmented-control--size-lg")).toBe(true);
  });

  it("disables segment buttons when disabled", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SegmentedControl value="grid" onChange={onChange} options={[...options]} disabled />,
    );
    const root = container.querySelector(".segmented-control");
    const buttons = container.querySelectorAll("button");
    expect(root?.getAttribute("aria-disabled")).toBe("true");
    expect(root?.hasAttribute("data-disabled")).toBe(true);
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => expect(button.disabled).toBe(true));
  });

  it("shows a tooltip for icon-only segments", async () => {
    renderWithTooltip(
      <SegmentedControl value="grid" onChange={vi.fn()} options={[...iconOptions]} />,
    );
    fireEvent.pointerMove(screen.getByRole("button", { name: "Grid view" }));
    expect((await screen.findByRole("tooltip")).textContent).toBe("Grid view");
  });

  it("renders icon and visible label together when showLabel is set", () => {
    const labeled = rsvpOptions.map((option) => ({ ...option, showLabel: true }));
    const { container } = renderWithTooltip(
      <SegmentedControl value={null} onChange={vi.fn()} options={labeled} />,
    );

    const accept = screen.getByRole("button", { name: "Accept" });
    expect(accept.className).toContain("segmented-control__button--text");
    expect(accept.textContent).toContain("Accept");
    expect(screen.getByTestId("accept-icon")).toBeTruthy();
    expect(screen.getByTestId("maybe-icon")).toBeTruthy();
    expect(screen.getByTestId("decline-icon")).toBeTruthy();
    expect(container.querySelectorAll(".segmented-control__label")).toHaveLength(3);
  });

  it("skips tooltips when the label is visible beside the icon", async () => {
    const labeled = rsvpOptions.map((option) => ({ ...option, showLabel: true }));
    renderWithTooltip(<SegmentedControl value={null} onChange={vi.fn()} options={labeled} />);
    fireEvent.pointerMove(screen.getByRole("button", { name: "Accept" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("skips tooltips for icon-only segments when showTooltip is false", async () => {
    renderWithTooltip(
      <SegmentedControl
        value="grid"
        onChange={vi.fn()}
        options={[...iconOptions]}
        showTooltip={false}
      />,
    );
    fireEvent.pointerMove(screen.getByRole("button", { name: "Grid view" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("has no active thumb or pressed option when value is null", () => {
    const onChange = vi.fn();
    const { container } = renderWithTooltip(
      <SegmentedControl value={null} onChange={onChange} options={rsvpOptions} />,
    );

    const root = container.querySelector(".segmented-control") as HTMLElement;
    expect(root?.classList.contains("segmented-control--unselected")).toBe(true);
    expect(root?.hasAttribute("data-thumb-ready")).toBe(false);
    expect(root?.hasAttribute("data-thumb-animate")).toBe(false);
    expect(root.style.getPropertyValue("--segmented-control-thumb-width")).toBe("");
    expect(container.querySelector(".segmented-control__button--active")).toBeNull();
    for (const name of ["Accept", "Maybe", "Decline"]) {
      const button = screen.getByRole("button", { name });
      expect(button.getAttribute("aria-pressed")).toBeNull();
      expect(button.className).not.toContain("segmented-control__button--active");
    }

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onChange).toHaveBeenCalledWith("accepted");
  });

  it("snaps thumb on mount with a selected value (no animate until after first paint)", async () => {
    const { container, unmount } = renderWithTooltip(
      <SegmentedControl value="accepted" onChange={vi.fn()} options={rsvpOptions} />,
    );

    const root = container.querySelector(".segmented-control") as HTMLElement;
    expect(root?.hasAttribute("data-thumb-ready")).toBe(true);
    // Contract: remounting invitation cards must not replay a slide-in.
    expect(root?.hasAttribute("data-thumb-animate")).toBe(false);
    expect(root.style.getPropertyValue("--segmented-control-thumb-width")).not.toBe("");

    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
    expect(root?.hasAttribute("data-thumb-animate")).toBe(true);

    unmount();
    const remounted = renderWithTooltip(
      <SegmentedControl value="accepted" onChange={vi.fn()} options={rsvpOptions} />,
    );
    const remountRoot = remounted.container.querySelector(".segmented-control");
    expect(remountRoot?.hasAttribute("data-thumb-ready")).toBe(true);
    expect(remountRoot?.hasAttribute("data-thumb-animate")).toBe(false);
    remounted.unmount();
  });

  it("clears thumb geometry when returning to an idle null value", async () => {
    const { container, rerender } = renderWithTooltip(
      <SegmentedControl value="accepted" onChange={vi.fn()} options={rsvpOptions} />,
    );
    const root = container.querySelector(".segmented-control") as HTMLElement;
    expect(root.style.getPropertyValue("--segmented-control-thumb-width")).not.toBe("");

    rerender(
      <TooltipProvider delayDuration={0}>
        <SegmentedControl value={null} onChange={vi.fn()} options={rsvpOptions} />
      </TooltipProvider>,
    );
    expect(root.classList.contains("segmented-control--unselected")).toBe(true);
    expect(root.hasAttribute("data-thumb-ready")).toBe(false);
    expect(root.style.getPropertyValue("--segmented-control-thumb-width")).toBe("");
    expect(root.style.getPropertyValue("--segmented-control-thumb-x")).toBe("");
  });

  it("renders three options with per-option severity and a sliding thumb", () => {
    const onChange = vi.fn();
    const { container, rerender } = renderWithTooltip(
      <SegmentedControl value="tentative" onChange={onChange} options={rsvpOptions} />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Accept" }).className).toContain(
      "segmented-control__button--severity-success",
    );
    expect(screen.getByRole("button", { name: "Decline" }).className).toContain(
      "segmented-control__button--severity-danger",
    );
    expect(screen.getByRole("button", { name: "Maybe" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Accept" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(container.querySelector(".segmented-control__thumb")).toBeTruthy();
    expect(container.querySelector(".segmented-control__thumb--severity-success")).toBeNull();
    expect(container.querySelector(".segmented-control__thumb--severity-danger")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onChange).toHaveBeenCalledWith("accepted");

    rerender(
      <TooltipProvider delayDuration={0}>
        <SegmentedControl value="accepted" onChange={onChange} options={rsvpOptions} />
      </TooltipProvider>,
    );
    expect(container.querySelector(".segmented-control__thumb--severity-success")).toBeTruthy();
  });

  it("renders a compact switch for boolean on/off", () => {
    const onChange = vi.fn();
    render(<BooleanSegmentedControl value={false} onChange={onChange} aria-label="Feature" />);
    const control = screen.getByRole("switch", { name: "Feature" });
    expect(control.classList.contains("switch")).toBe(true);
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
