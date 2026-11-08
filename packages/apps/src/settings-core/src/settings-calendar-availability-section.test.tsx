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
  it("starts off with one explanatory line and no Teams or calendars", async () => {
    renderSection(createMockCalendarAvailabilitySettingsOperations());
    const toggle = await screen.findByRole("switch", { name: labels.switch });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(labels.offHint)).toBeTruthy();
    expect(screen.queryByText(labels.teamsHeading)).toBeNull();
    expect(screen.queryByText(labels.calendarsHeading)).toBeNull();
    expect(screen.queryByText(labels.footer)).toBeNull();
  });

  it("shows Teams, calendars with their defaults and the footer once on", async () => {
    renderSection(createMockCalendarAvailabilitySettingsOperations());
    fireEvent.click(await screen.findByRole("switch", { name: labels.switch }));

    expect(screen.getByText("Design")).toBeTruthy();
    expect(screen.queryByText(labels.offHint)).toBeNull();
    expect(screen.getByText(labels.footer)).toBeTruthy();
    const personal = calendarRow("Personal");
    expect(within(personal).getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    expect(within(personal).getByRole("combobox").textContent).toContain(labels.detailBusy);
    expect(screen.queryByText("US Holidays")).toBeNull();
  });

  it("names each control after its calendar", async () => {
    renderSection(
      createMockCalendarAvailabilitySettingsOperations(
        mockCalendarAvailabilitySettings({ enabled: true }),
      ),
    );
    expect(await screen.findByRole("checkbox", { name: `${labels.include} Work` })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: `${labels.detail} Work` })).toBeTruthy();
  });

  it("notes when the owner is in no Team yet", async () => {
    renderSection(
      createMockCalendarAvailabilitySettingsOperations(
        mockCalendarAvailabilitySettings({ enabled: true, teams: [] }),
      ),
    );
    expect(await screen.findByText(labels.teamsNone)).toBeTruthy();
  });

  it("disables the detail select while the calendar does not count", async () => {
    renderSection(
      createMockCalendarAvailabilitySettingsOperations(
        mockCalendarAvailabilitySettings({ enabled: true }),
      ),
    );
    await screen.findByText(labels.footer);
    const work = calendarRow("Work");
    expect((within(work).getByRole("combobox") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(work).getByRole("checkbox"));
    expect((within(work).getByRole("combobox") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a Team calendar with a fixed Time only and the whole-Team hint", async () => {
    renderSection(
      createMockCalendarAvailabilitySettingsOperations(
        mockCalendarAvailabilitySettings({ enabled: true }),
      ),
    );
    await screen.findByText(labels.footer);
    const team = calendarRow("Editorial");
    expect(within(team).queryByRole("combobox")).toBeNull();
    expect(within(team).getByText(labels.detailBusy)).toBeTruthy();
    expect(within(team).getByText(labels.teamHint)).toBeTruthy();
    expect(within(team).getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
  });

  it("saves the switch and changed calendars through the REST operations", async () => {
    const operations = spiedOperations(mockCalendarAvailabilitySettings());
    renderSection(operations);
    const save = await screen.findByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("switch", { name: labels.switch }));
    fireEvent.click(within(calendarRow("Work")).getByRole("checkbox"));
    fireEvent.click(within(calendarRow("Editorial")).getByRole("checkbox"));
    fireEvent.click(save);

    await waitFor(() => expect(operations.save).toHaveBeenCalledTimes(1));
    expect(operations.save).toHaveBeenCalledWith({
      enabled: true,
      calendars: [
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
    fireEvent.click(within(calendarRow("Work")).getByRole("checkbox"));
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
