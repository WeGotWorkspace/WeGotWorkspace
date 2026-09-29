import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsCalendarPane } from "@/settings-core/src/settings-calendar-pane";

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
}));

afterEach(() => {
  window.localStorage.clear();
});

describe("SettingsCalendarPane", () => {
  it("renders timezone, working hours, and locale without placeholder copy", () => {
    render(<SettingsCalendarPane />);
    expect(screen.getByRole("combobox", { name: "Timezone" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Locale" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Working hours start" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Working hours end" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText(/placeholder/i)).toBeNull();
  });
});
