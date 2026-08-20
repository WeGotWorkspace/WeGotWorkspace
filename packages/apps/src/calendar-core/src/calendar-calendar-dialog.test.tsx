import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CalendarCalendarDialog,
  DEFAULT_CALENDAR_COLOR,
} from "@/calendar-core/src/calendar-calendar-dialog";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";

const groups = [
  { slug: "team", displayName: "Team" },
  { slug: "studio", displayName: "Studio Crew" },
];

describe("CalendarCalendarDialog", () => {
  beforeEach(() => {
    cleanup();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("submits trimmed create payload with personal directory", () => {
    const onConfirm = vi.fn();

    render(
      <CalendarCalendarDialog
        dialog={{ mode: "create" }}
        groups={groups}
        personalOwnerLabel="Demo User"
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.calendarNameLabel), {
      target: { value: "  Launch  " },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.save }));

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Launch",
      color: DEFAULT_CALENDAR_COLOR,
      groupSlug: null,
    });
  });

  it("submits group directory when a group is selected from the Owner dropdown", () => {
    const onConfirm = vi.fn();

    render(
      <CalendarCalendarDialog
        dialog={{ mode: "create" }}
        groups={groups}
        personalOwnerLabel="Demo User"
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.calendarNameLabel), {
      target: { value: "Roadmap" },
    });
    const ownerSelect = screen.getByRole("combobox", {
      name: defaultCalendarLabels.calendarDirectoryLabel,
    });
    expect(ownerSelect.textContent).toContain("Only Me");
    fireEvent.click(ownerSelect);
    fireEvent.click(
      screen.getByRole("option", {
        name: defaultCalendarLabels.calendarDirectoryGroup("Team"),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.save }));

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Roadmap",
      color: DEFAULT_CALENDAR_COLOR,
      groupSlug: "team",
    });
  });

  it("still shows the Owner dropdown when the user has no groups", () => {
    render(
      <CalendarCalendarDialog
        dialog={{ mode: "create" }}
        groups={[]}
        personalOwnerLabel="Demo User"
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const ownerSelect = screen.getByRole("combobox", {
      name: defaultCalendarLabels.calendarDirectoryLabel,
    });
    expect(ownerSelect.textContent).toContain("Only Me");
  });

  it("shows the same Owner dropdown disabled on edit", () => {
    render(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "cal-1",
          name: "Team sync",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: false,
          scope: "group",
          groupSlug: "team",
        }}
        groups={groups}
        personalOwnerLabel="Demo User"
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const ownerSelect = screen.getByRole("combobox", {
      name: defaultCalendarLabels.calendarDirectoryLabel,
    });
    expect(ownerSelect).toHaveProperty("disabled", true);
    expect(ownerSelect.textContent).toContain("Team (Group)");

    fireEvent.click(ownerSelect);
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("keeps the dialog open when the native color well changes", async () => {
    const onClose = vi.fn();

    render(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "cal-1",
          name: "Calendar",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: false,
        }}
        groups={groups}
        personalOwnerLabel="Demo User"
        labels={defaultCalendarLabels}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.calendarColorLabel }));
    const colorInput = screen.getByLabelText("Custom color") as HTMLInputElement;
    expect(colorInput).toBeTruthy();
    expect(colorInput.getAttribute("type")).toBe("color");

    fireEvent.focus(colorInput);
    fireEvent.input(colorInput, { target: { value: "#31c75c" } });
    fireEvent.change(colorInput, { target: { value: "#31c75c" } });

    expect(onClose).not.toHaveBeenCalled();
    expect(colorInput.isConnected).toBe(true);
    expect(
      screen.getByRole("heading", { name: defaultCalendarLabels.editCalendarTitle }),
    ).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerDown(document.documentElement);

    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: defaultCalendarLabels.editCalendarTitle }),
    ).toBeTruthy();
  });
});
