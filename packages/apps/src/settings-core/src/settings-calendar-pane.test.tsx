import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCalendarDisplayPrefs, writeCalendarDisplayPrefs } from "@/lib/calendar-display-prefs";
import { workspaceLabels } from "@/lib/workspace/workspace-labels";
import { SettingsCalendarPane } from "@/settings-core/src/settings-calendar-pane";
import { AutosaveStatusProvider, AutosaveStatusTag } from "@/ui/autosave-status";

const liveApi = vi.hoisted(() => ({ enabled: false }));
const calendarGet = vi.hoisted(() => ({
  current: Promise.resolve({ list: [] as unknown[] }),
}));

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
}));

vi.mock("@/lib/api/wgw/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/wgw/http")>("@/lib/api/wgw/http");
  return { ...actual, wgwLiveApiEnabled: () => liveApi.enabled };
});

vi.mock("@/lib/api/wgw/calendar", () => ({
  calendarJmapClient: () => ({
    isConnected: true,
    connect: () => Promise.resolve(),
    primaryAccountId: () => "acct",
  }),
}));

vi.mock("@/lib/jmap-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/jmap-client")>("@/lib/jmap-client");
  return {
    ...actual,
    JmapCalendarsClient: class {
      getCalendars() {
        return calendarGet.current;
      }
    },
  };
});

afterEach(() => {
  liveApi.enabled = false;
  calendarGet.current = Promise.resolve({ list: [] });
  window.localStorage.clear();
});

describe("SettingsCalendarPane", () => {
  it("renders default calendar, timezone, week start, and visible hours, without day-start or placeholder copy", () => {
    render(<SettingsCalendarPane />);
    expect(screen.getByRole("combobox", { name: "Timezone" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Week starts on" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Visible hours" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Day starts on" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Starts at" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Default" })).toBeNull();
    const trigger = screen.getByRole("combobox", { name: "Default calendar" });
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain("Personal");
    const timezone = screen.getByRole("combobox", { name: "Timezone" });
    const weekStart = screen.getByRole("combobox", { name: "Week starts on" });
    const visibleHours = screen.getByRole("combobox", { name: "Visible hours" });
    expect(trigger.compareDocumentPosition(timezone) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(timezone.compareDocumentPosition(weekStart) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(weekStart.compareDocumentPosition(visibleHours) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(visibleHours.textContent).toMatch(/12 hours/);
    expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Locale" })).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText(/placeholder/i)).toBeNull();
    expect(screen.queryByRole("combobox", { name: /working hours/i })).toBeNull();
    expect(document.querySelector(".settings-pane-card")).toBeTruthy();
  });

  it("keeps a saved calendar while the live list is in flight and after it resolves", async () => {
    writeCalendarDisplayPrefs({ inviteCalendarId: "work" });
    let resolveCalendars!: (value: { list: unknown[] }) => void;
    calendarGet.current = new Promise((resolve) => {
      resolveCalendars = resolve;
    });
    liveApi.enabled = true;

    render(<SettingsCalendarPane />);

    expect(screen.queryByRole("combobox", { name: "Default calendar" })).toBeNull();

    resolveCalendars({
      list: [
        { id: "default", name: "Calendar", color: "#6366f1", isDefault: true },
        { id: "work", name: "Work", color: "#0ea5e9", isDefault: false },
      ],
    });

    const trigger = await screen.findByRole("combobox", { name: "Default calendar" });
    expect(trigger.textContent).toContain("Work");
    expect(readCalendarDisplayPrefs().inviteCalendarId).toBe("work");
  });

  it("saves the replacement when the stored calendar no longer exists", async () => {
    writeCalendarDisplayPrefs({ inviteCalendarId: "deleted" });
    calendarGet.current = Promise.resolve({
      list: [
        { id: "default", name: "Calendar", color: "#6366f1", isDefault: true },
        { id: "work", name: "Work", color: "#0ea5e9", isDefault: false },
      ],
    });
    liveApi.enabled = true;

    render(
      <AutosaveStatusProvider>
        <AutosaveStatusTag />
        <SettingsCalendarPane />
      </AutosaveStatusProvider>,
    );

    await waitFor(() => expect(readCalendarDisplayPrefs().inviteCalendarId).toBe("default"));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(workspaceLabels.dialog.saved),
    );
  });

  it("hides the calendar picker when the live list fails", async () => {
    calendarGet.current = Promise.reject(new Error("offline"));
    liveApi.enabled = true;

    render(<SettingsCalendarPane />);

    await waitFor(() => {
      expect(screen.queryByRole("combobox", { name: "Default calendar" })).toBeNull();
    });
    expect(readCalendarDisplayPrefs().inviteCalendarId).toBeUndefined();
  });
});
