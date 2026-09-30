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
  it("renders default calendar first, then timezone and day starts on, without language or placeholder copy", async () => {
    render(<SettingsCalendarPane />);
    expect(screen.getByRole("combobox", { name: "Timezone" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Day starts on" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    await waitFor(() => {
      const trigger = screen.getByRole("button", { name: /Default calendar: Personal/i });
      expect(trigger).toBeTruthy();
      expect(trigger.textContent).toContain("Personal");
      const timezone = screen.getByRole("combobox", { name: "Timezone" });
      const weekStart = screen.getByRole("combobox", { name: "Day starts on" });
      expect(trigger.compareDocumentPosition(timezone) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(timezone.compareDocumentPosition(weekStart) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Locale" })).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText(/placeholder/i)).toBeNull();
    expect(screen.queryByRole("combobox", { name: /working hours/i })).toBeNull();
    expect(document.querySelector(".settings-pane-card")).toBeTruthy();
  });
});
