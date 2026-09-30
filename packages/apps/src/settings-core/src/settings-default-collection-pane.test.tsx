import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SettingsContactsPane,
  SettingsNotesPane,
  SettingsTasksPane,
} from "@/settings-core/src/settings-default-collection-pane";

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
}));

afterEach(() => {
  window.localStorage.clear();
});

describe("SettingsDefaultCollectionPane", () => {
  it("renders Default list with the Inbox name on the closed trigger", async () => {
    render(<SettingsTasksPane />);
    await waitFor(() => {
      const trigger = screen.getByRole("button", { name: /Default list: Inbox/i });
      expect(trigger.textContent).toContain("Inbox");
    });
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it("renders Default address book with Personal on the closed trigger", async () => {
    render(<SettingsContactsPane />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Default address book: Personal/i }).textContent,
      ).toContain("Personal");
    });
  });

  it("renders Default notebook with The Journal on the closed trigger", async () => {
    render(<SettingsNotesPane />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Default notebook: The Journal/i }).textContent,
      ).toContain("The Journal");
    });
  });
});
