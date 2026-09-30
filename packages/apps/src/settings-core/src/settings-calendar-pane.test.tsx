import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsCalendarPane } from "@/settings-core/src/settings-calendar-pane";

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
}));

afterEach(() => {
  window.localStorage.clear();
});

describe("SettingsCalendarPane", () => {
  it("renders default calendar first, then timezone and visible hours, without day-start or placeholder copy", async () => {
    render(<SettingsCalendarPane />);
    expect(screen.getByRole("combobox", { name: "Timezone" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Visible hours" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Day starts on" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Starts at" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Default" })).toBeNull();
    await waitFor(() => {
      const trigger = screen.getByRole("button", { name: /Default calendar: Personal/i });
      expect(trigger).toBeTruthy();
      expect(trigger.textContent).toContain("Personal");
      const timezone = screen.getByRole("combobox", { name: "Timezone" });
      const visibleHours = screen.getByRole("combobox", { name: "Visible hours" });
      expect(trigger.compareDocumentPosition(timezone) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(
        timezone.compareDocumentPosition(visibleHours) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(visibleHours.textContent).toMatch(/12 hours/);
    });
    expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Locale" })).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText(/placeholder/i)).toBeNull();
    expect(screen.queryByRole("combobox", { name: /working hours/i })).toBeNull();
    expect(document.querySelector(".settings-pane-card")).toBeTruthy();
  });
});
