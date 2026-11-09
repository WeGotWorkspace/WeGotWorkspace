import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockCalendarAvailabilitySettingsOperations,
  mockCalendarAvailabilitySettings,
} from "@/lib/api/mock/calendar-availability-settings";
import type { CalendarAvailabilitySettingsOperations } from "@/lib/api/wgw/calendar-availability";
import { calendarAvailabilityLabels as labels } from "@/settings-core/src/settings-calendar-availability-labels";
import { SettingsCalendarAvailabilitySection } from "@/settings-core/src/settings-calendar-availability-section";
import { notifySettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";
import { TooltipProvider } from "@/ui/tooltip";
import type { CalendarAvailabilitySettings } from "@wgw/openapi-types/calendars-types";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ showSuccess: toast.success, showError: toast.error }),
}));

vi.mock("@/settings-core/src/settings-slice-saved", async () => {
  const actual = await vi.importActual<typeof import("@/settings-core/src/settings-slice-saved")>(
    "@/settings-core/src/settings-slice-saved",
  );
  return { ...actual, notifySettingsSliceSaved: vi.fn() };
});

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

function renderSection(operations: CalendarAvailabilitySettingsOperations) {
  return render(
    <TooltipProvider>
      <SettingsCalendarAvailabilitySection operations={operations} />
    </TooltipProvider>,
  );
}

function spiedOperations(seed: CalendarAvailabilitySettings) {
  const operations = createMockCalendarAvailabilitySettingsOperations(seed);
  vi.spyOn(operations, "save");
  return operations;
}

function calendarRow(name: string): HTMLElement {
  const row = screen.getByText(name, { selector: ".settings-availability__calendar-label" });
  return row.closest("li")!;
}

/** The texts an element's `aria-describedby` points at, in order. */
function descriptions(element: HTMLElement): string[] {
  const ids = (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? `missing #${id}`);
}

/** Picks one option in a calendar row's dropdown (Radix Select). */
function choose(calendar: string, option: string): void {
  fireEvent.click(screen.getByRole("combobox", { name: calendar }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

function optionNames(calendar: string): string[] {
  fireEvent.click(screen.getByRole("combobox", { name: calendar }));
  const names = screen.getAllByRole("option").map((option) => option.textContent ?? "");
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  return names;
}

beforeEach(() => {
  setOnline(true);
  toast.success.mockClear();
  toast.error.mockClear();
  vi.mocked(notifySettingsSliceSaved).mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  setOnline(true);
});

describe("SettingsCalendarAvailabilitySection", () => {
  it("starts off with one explanatory line and no calendars", async () => {
    renderSection(createMockCalendarAvailabilitySettingsOperations());
    const toggle = await screen.findByRole("switch", { name: labels.switch });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(labels.offHint)).toBeTruthy();
    expect(screen.queryByText(labels.calendarsHeading)).toBeNull();
    expect(screen.queryByText(labels.footer)).toBeNull();
  });

  it("shows the calendars with their defaults and the footer once on, without a Teams list", async () => {
    renderSection(createMockCalendarAvailabilitySettingsOperations());
    fireEvent.click(await screen.findByRole("switch", { name: labels.switch }));

    expect(screen.queryByText(labels.offHint)).toBeNull();
    expect(screen.getByText(labels.footer)).toBeTruthy();
    expect(screen.queryByText("Design")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    const personal = calendarRow("Personal");
    expect(within(personal).getByRole("combobox").textContent).toContain(labels.detailBusy);
    expect(screen.queryByText("US Holidays")).toBeNull();
  });

  it("names each dropdown after its calendar", async () => {
    renderSection(
      createMockCalendarAvailabilitySettingsOperations(
        mockCalendarAvailabilitySettings({ enabled: true }),
      ),
    );
    expect(await screen.findByRole("combobox", { name: "Work" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Editorial" })).toBeTruthy();
  });

  it("offers Do not add and both detail levels on a personal calendar", async () => {
    renderSection(
      createMockCalendarAvailabilitySettingsOperations(
        mockCalendarAvailabilitySettings({ enabled: true }),
      ),
    );
    await screen.findByText(labels.footer);
    expect(optionNames("Work")).toEqual([labels.exclude, labels.detailBusy, labels.detailDetails]);
  });

  it("shows Do not add for a calendar that does not count", async () => {
    const seed = mockCalendarAvailabilitySettings({ enabled: true });
    seed.calendars = seed.calendars.map((calendar) =>
      calendar.calendarId === "work"
        ? { ...calendar, include: false, detail: "details" }
        : calendar,
    );
    renderSection(createMockCalendarAvailabilitySettingsOperations(seed));
    const work = await screen.findByRole("combobox", { name: "Work" });
    expect(work.textContent).toContain(labels.exclude);
    expect(calendarRow("Work").dataset.included).toBe("false");
  });

  it("offers a Team calendar Do not add and Time only", async () => {
    renderSection(
      createMockCalendarAvailabilitySettingsOperations(
        mockCalendarAvailabilitySettings({ enabled: true }),
      ),
    );
    await screen.findByText(labels.footer);
    const team = calendarRow("Editorial");
    expect(within(team).getByRole("combobox").textContent).toContain(labels.detailBusy);
    expect(optionNames("Editorial")).toEqual([labels.exclude, labels.detailBusy]);
  });

  it("puts the whole-Team hint in the suite tooltip on the Team tag", async () => {
    renderSection(
      createMockCalendarAvailabilitySettingsOperations(
        mockCalendarAvailabilitySettings({ enabled: true }),
      ),
    );
    await screen.findByText(labels.footer);
    const team = calendarRow("Editorial");
    expect(within(calendarRow("Work")).queryByText(labels.teamBadge)).toBeNull();
    // Only in the tooltip, not as a line in the row.
    expect(screen.queryByText(labels.teamHint)).toBeNull();

    // The tag can take keyboard focus, and focus opens the tooltip.
    const tag = within(team).getByText(labels.teamBadge);
    expect(tag.tabIndex).toBe(0);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => tag.focus());
    expect((await screen.findByRole("tooltip")).textContent).toBe(labels.teamHint);
    // Radix describes the tag by the tooltip once, not twice.
    expect(descriptions(tag)).toEqual([labels.teamHint]);

    fireEvent.keyDown(tag, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("saves the switch and changed calendars through the REST operations", async () => {
    const operations = spiedOperations(mockCalendarAvailabilitySettings());
    renderSection(operations);
    const save = await screen.findByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("switch", { name: labels.switch }));
    choose("Personal", labels.detailDetails);
    choose("Work", labels.exclude);
    choose("Editorial", labels.exclude);
    fireEvent.click(save);

    await waitFor(() => expect(operations.save).toHaveBeenCalledTimes(1));
    expect(operations.save).toHaveBeenCalledWith({
      enabled: true,
      calendars: [
        { calendarId: "default", detail: "details" },
        { calendarId: "work", include: false },
        { calendarId: "group-editorial", include: false },
      ],
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(labels.saved, expect.anything()),
    );
    expect(notifySettingsSliceSaved).toHaveBeenCalledWith({
      panelId: "calendar",
      sliceId: "calendar-availability",
    });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });

  it("shows an error toast and sends nothing when saving offline", async () => {
    const operations = spiedOperations(mockCalendarAvailabilitySettings());
    renderSection(operations);
    fireEvent.click(await screen.findByRole("switch", { name: labels.switch }));
    act(() => setOnline(false));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(labels.saveOffline));
    expect(operations.save).not.toHaveBeenCalled();
    expect(notifySettingsSliceSaved).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("shows the plain save error when the server rejects the change", async () => {
    renderSection({
      load: async () => mockCalendarAvailabilitySettings(),
      save: () => Promise.reject(new Error("PUT /calendars/availability failed (422)")),
    });
    fireEvent.click(await screen.findByRole("switch", { name: labels.switch }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(labels.saveError));
    expect(notifySettingsSliceSaved).not.toHaveBeenCalled();
  });

  it("says it needs a connection when opened offline, and loads once back online", async () => {
    setOnline(false);
    const operations = createMockCalendarAvailabilitySettingsOperations();
    const load = vi.spyOn(operations, "load");
    renderSection(operations);
    expect(await screen.findByText(labels.offline)).toBeTruthy();
    expect(load).not.toHaveBeenCalled();

    act(() => setOnline(true));
    expect(await screen.findByRole("switch", { name: labels.switch })).toBeTruthy();
  });

  it("offers Try again after a load error", async () => {
    let fail = true;
    renderSection({
      load: async () => {
        if (fail) throw new Error("GET /calendars/availability failed (500)");
        return mockCalendarAvailabilitySettings();
      },
      save: async () => mockCalendarAvailabilitySettings(),
    });
    expect(await screen.findByText(labels.loadError)).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: labels.retry }));
    expect(await screen.findByRole("switch", { name: labels.switch })).toBeTruthy();
  });

  it("re-reads a clean pane when the tab becomes visible again, but keeps unsaved edits", async () => {
    const operations = createMockCalendarAvailabilitySettingsOperations();
    renderSection(operations);
    const toggle = await screen.findByRole("switch", { name: labels.switch });

    // Another tab turned it on.
    await operations.save({ enabled: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));

    // A local edit is not overwritten by a later read.
    choose("Work", labels.exclude);
    await operations.save({ enabled: false });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole("switch", { name: labels.switch }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });
  it("re-reads a clean pane when another tab saved", async () => {
    const operations = createMockCalendarAvailabilitySettingsOperations();
    renderSection(operations);
    const toggle = await screen.findByRole("switch", { name: labels.switch });
    await operations.save({ enabled: true });

    const otherTab = new BroadcastChannel("wgw.settings.calendar-availability");
    otherTab.postMessage({ type: "calendar-availability-saved" });
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    otherTab.close();
  });
});
