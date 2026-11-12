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

/** A calendar's row: its label (with the color dot) and its dropdown. */
function calendarRow(name: string): HTMLElement {
  return screen.getByRole("combobox", { name }).closest<HTMLElement>(".field-label-row")!;
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
  });

  it("shows the calendars with their defaults once on, without a Teams list", async () => {
    renderSection(createMockCalendarAvailabilitySettingsOperations());
    fireEvent.click(await screen.findByRole("switch", { name: labels.switch }));

    expect(screen.getByText(labels.calendarsHeading)).toBeTruthy();
    expect(screen.queryByText("Design")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Personal" }).textContent).toContain(
      labels.detailBusy,
    );
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
    await screen.findByText(labels.calendarsHeading);
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
    // The calendar's name is dimmed while it does not count.
    expect(within(calendarRow("Work")).getByText("Work").className).toContain(
      "settings-availability__excluded",
    );
    expect(within(calendarRow("Editorial")).getByText("Editorial").className).not.toContain(
      "settings-availability__excluded",
    );
  });

  it("offers a Team calendar Do not add and Time only", async () => {
    renderSection(
      createMockCalendarAvailabilitySettingsOperations(
        mockCalendarAvailabilitySettings({ enabled: true }),
      ),
    );
    await screen.findByText(labels.calendarsHeading);
    expect(screen.getByRole("combobox", { name: "Editorial" }).textContent).toContain(
      labels.detailBusy,
    );
    expect(optionNames("Editorial")).toEqual([labels.exclude, labels.detailBusy]);
  });

  it("says under a Team calendar that it counts for the whole Team", async () => {
    renderSection(
      createMockCalendarAvailabilitySettingsOperations(
        mockCalendarAvailabilitySettings({ enabled: true }),
      ),
    );
    await screen.findByText(labels.calendarsHeading);
    expect(within(calendarRow("Editorial")).getByText(labels.teamHint)).toBeTruthy();
    expect(within(calendarRow("Work")).queryByText(labels.teamHint)).toBeNull();
    expect(screen.getAllByText(labels.teamHint)).toHaveLength(1);
  });

  it("saves the switch and changed calendars through the REST operations as they change", async () => {
    const operations = spiedOperations(mockCalendarAvailabilitySettings());
    renderSection(operations);
    fireEvent.click(await screen.findByRole("switch", { name: labels.switch }));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    // Changes within the autosave pause go out as one PUT.
    choose("Personal", labels.detailDetails);
    choose("Work", labels.exclude);
    choose("Editorial", labels.exclude);
    expect(operations.save).not.toHaveBeenCalled();

    await waitFor(() => expect(operations.save).toHaveBeenCalledTimes(1));
    expect(operations.save).toHaveBeenCalledWith({
      enabled: true,
      calendars: [
        { calendarId: "default", detail: "details" },
        { calendarId: "work", include: false },
        { calendarId: "group-editorial", include: false },
      ],
    });
    // Turning sharing on is confirmed; calendar choices stay quiet.
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(labels.sharingOn));
    expect(notifySettingsSliceSaved).toHaveBeenCalledWith({
      panelId: "calendar",
      sliceId: "calendar-availability",
    });
    expect(window.localStorage.length).toBe(0);
  });

  it("keeps and sends a change made while the previous save is still running", async () => {
    const mock = createMockCalendarAvailabilitySettingsOperations();
    let release!: () => void;
    const firstSaveHeld = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = vi.fn(async (update: Parameters<typeof mock.save>[0]) => {
      if (save.mock.calls.length === 1) await firstSaveHeld;
      return mock.save(update);
    });
    renderSection({ load: mock.load, save });
    fireEvent.click(await screen.findByRole("switch", { name: labels.switch }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    // The first PUT is still out when the user picks Do not add.
    choose("Work", labels.exclude);
    await act(async () => release());

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith({
      enabled: true,
      calendars: [{ calendarId: "work", include: false }],
    });
    expect(screen.getByRole("combobox", { name: "Work" }).textContent).toContain(labels.exclude);
  });

  it("shows an error toast and sends nothing when a change is made offline", async () => {
    const operations = spiedOperations(mockCalendarAvailabilitySettings());
    renderSection(operations);
    fireEvent.click(await screen.findByRole("switch", { name: labels.switch }));
    act(() => setOnline(false));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(labels.saveOffline));
    expect(operations.save).not.toHaveBeenCalled();
    expect(notifySettingsSliceSaved).not.toHaveBeenCalled();
    // The change stays in the pane.
    expect(screen.getByRole("switch", { name: labels.switch }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("shows the plain save error when the server rejects the change", async () => {
    renderSection({
      load: async () => mockCalendarAvailabilitySettings(),
      save: () => Promise.reject(new Error("PUT /calendars/availability failed (422)")),
    });
    fireEvent.click(await screen.findByRole("switch", { name: labels.switch }));
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
