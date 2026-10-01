import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SettingsContactsPane,
  SettingsNotesPane,
  SettingsTasksPane,
} from "@/settings-core/src/settings-default-collection-pane";

const liveApi = vi.hoisted(() => ({ enabled: false }));
const taskLists = vi.hoisted(() => ({
  current: Promise.resolve([] as unknown[]),
}));

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
}));

vi.mock("@/lib/api/wgw/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/wgw/http")>("@/lib/api/wgw/http");
  return { ...actual, wgwLiveApiEnabled: () => liveApi.enabled };
});

vi.mock("@/lib/api/wgw/tasks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/wgw/tasks")>("@/lib/api/wgw/tasks");
  return { ...actual, listTaskLists: () => taskLists.current };
});

afterEach(() => {
  liveApi.enabled = false;
  taskLists.current = Promise.resolve([]);
  window.localStorage.clear();
});

describe("SettingsDefaultCollectionPane", () => {
  it("renders Default list with the Inbox name on the closed trigger", () => {
    render(<SettingsTasksPane />);
    const trigger = screen.getByRole("button", { name: /Default list: Inbox/i });
    expect(trigger.textContent).toContain("Inbox");
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it("renders Default address book with Personal on the closed trigger", () => {
    render(<SettingsContactsPane />);
    expect(
      screen.getByRole("button", { name: /Default address book: Personal/i }).textContent,
    ).toContain("Personal");
  });

  it("renders Default notebook with The Journal on the closed trigger", () => {
    render(<SettingsNotesPane />);
    expect(
      screen.getByRole("button", { name: /Default notebook: The Journal/i }).textContent,
    ).toContain("The Journal");
  });

  it("shows the owned task default before the live list returns and keeps it selectable", async () => {
    let resolveLists!: (lists: unknown[]) => void;
    taskLists.current = new Promise((resolve) => {
      resolveLists = resolve;
    });
    liveApi.enabled = true;

    render(<SettingsTasksPane />);

    const beforeLoad = screen.getByRole("button", { name: /Default list: Inbox/i });
    expect(beforeLoad.textContent).toContain("Inbox");
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);

    resolveLists([
      {
        id: "work",
        name: "Work",
        color: "#f59e0b",
        isDefault: false,
        myRights: { mayWriteAll: true },
      },
      {
        id: "tasks-inbox",
        name: "Inbox",
        color: "#6366f1",
        isDefault: true,
        role: "inbox",
        myRights: { mayWriteAll: true },
      },
    ]);

    const trigger = await screen.findByRole("button", { name: /Default list: Inbox/i });
    expect(trigger.textContent).toContain("Inbox");
    expect(screen.queryByRole("button", { name: /Default list: Work/i })).toBeNull();

    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    const inbox = await screen.findByRole("menuitem", { name: "Inbox" });
    expect(screen.getByRole("menuitem", { name: "Work" })).toBeTruthy();
    fireEvent.click(inbox);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
    });
  });
});
