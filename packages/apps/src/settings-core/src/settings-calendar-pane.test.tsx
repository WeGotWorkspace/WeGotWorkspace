import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeCalendarDisplayPrefs } from "@/lib/calendar-display-prefs";
import { SettingsCalendarPane } from "@/settings-core/src/settings-calendar-pane";

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
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Day starts on" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Starts at" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Default" })).toBeNull();
    const trigger = screen.getByRole("button", { name: /Default calendar: Personal/i });
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

    expect(screen.queryByRole("button", { name: /Default calendar:/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);

    resolveCalendars({
      list: [
        { id: "default", name: "Calendar", color: "#6366f1", isDefault: true },
        { id: "work", name: "Work", color: "#0ea5e9", isDefault: false },
      ],
    });

    const trigger = await screen.findByRole("button", { name: /Default calendar: Work/i });
    expect(trigger.textContent).toContain("Work");
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  });

  it("hides the calendar picker when the live list fails", async () => {
    calendarGet.current = Promise.reject(new Error("offline"));
    liveApi.enabled = true;

    render(<SettingsCalendarPane />);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Default calendar:/i })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  });
});
