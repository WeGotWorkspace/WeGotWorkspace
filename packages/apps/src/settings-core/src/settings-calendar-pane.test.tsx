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
  it("renders timezone, language, day starts on, and incoming invites without placeholder copy", async () => {
    render(<SettingsCalendarPane />);
    expect(screen.getByRole("combobox", { name: "Timezone" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Language" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Day starts on" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Incoming invites: Personal/i })).toBeTruthy();
    });
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText(/placeholder/i)).toBeNull();
    expect(screen.queryByRole("combobox", { name: /working hours/i })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Locale" })).toBeNull();
  });
});
