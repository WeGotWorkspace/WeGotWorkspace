import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readDefaultCollectionId,
  writeDefaultCollectionPrefs,
} from "@/lib/default-collection-prefs";
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
    const trigger = screen.getByRole("combobox", { name: "Default list" });
    expect(trigger.textContent).toContain("Inbox");
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it("renders Default address book with Personal on the closed trigger", () => {
    render(<SettingsContactsPane />);
    expect(screen.getByRole("combobox", { name: "Default address book" }).textContent).toContain(
      "Personal",
    );
  });

  it("renders Default notebook with The Journal on the closed trigger", () => {
    render(<SettingsNotesPane />);
    expect(screen.getByRole("combobox", { name: "Default notebook" }).textContent).toContain(
      "The Journal",
    );
  });

  it("shows the owned task default before the live list returns without storing it", async () => {
    let resolveLists!: (lists: unknown[]) => void;
    taskLists.current = new Promise((resolve) => {
      resolveLists = resolve;
    });
    liveApi.enabled = true;

    render(<SettingsTasksPane />);

    const beforeLoad = screen.getByRole("combobox", { name: "Default list" });
    expect(beforeLoad.textContent).toContain("Inbox");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

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

    const trigger = await screen.findByRole("combobox", { name: "Default list" });
    expect(trigger.textContent).toContain("Inbox");
    expect(trigger.textContent).not.toContain("Work");
    expect(readDefaultCollectionId("tasks")).toBeUndefined();
  });

  it("keeps a saved task list while the live list is in flight and after it resolves", async () => {
    writeDefaultCollectionPrefs("tasks", { collectionId: "tasks-work" });
    let resolveLists!: (lists: unknown[]) => void;
    taskLists.current = new Promise((resolve) => {
      resolveLists = resolve;
    });
    liveApi.enabled = true;

    render(<SettingsTasksPane />);

    expect(screen.queryByRole("combobox", { name: "Default list" })).toBeNull();

    resolveLists([
      {
        id: "tasks-inbox",
        name: "Inbox",
        color: "#6366f1",
        isDefault: true,
        myRights: { mayWriteAll: true },
      },
      {
        id: "tasks-work",
        name: "Work",
        color: "#f59e0b",
        isDefault: false,
        myRights: { mayWriteAll: true },
      },
    ]);

    const trigger = await screen.findByRole("combobox", { name: "Default list" });
    expect(trigger.textContent).toContain("Work");
    expect(readDefaultCollectionId("tasks")).toBe("tasks-work");
  });

  it("hides the task picker when the live list fails", async () => {
    taskLists.current = Promise.reject(new Error("offline"));
    liveApi.enabled = true;

    render(<SettingsTasksPane />);

    await waitFor(() => {
      expect(screen.queryByRole("combobox", { name: "Default list" })).toBeNull();
    });
    expect(readDefaultCollectionId("tasks")).toBeUndefined();
  });
});
