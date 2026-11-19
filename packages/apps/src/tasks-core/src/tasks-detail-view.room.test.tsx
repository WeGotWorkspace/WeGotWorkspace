import type React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { Task } from "@/lib/models/tasks-types";
import { NoteCollabYDocProvider } from "@/note-detail-view/src/use-note-title-field";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TASK_DETAIL_SAVE_DEBOUNCE_MS, TasksDetailView } from "@/tasks-core/src/tasks-detail-view";
import type { TaskTextCollabConfig } from "@/tasks-core/src/use-task-text-collab";
import { TooltipProvider } from "@/ui/tooltip";

// The room itself is the shared session (tested in text-editor-core). Here a
// stand-in hands the detail its document, so the test covers what Tasks adds:
// the binding, the hold, and keeping the text out of the autosave.
const doc = { current: new Y.Doc() };
const scheduleSave = vi.fn();
const waiting = { current: false };
vi.mock("@/tasks-core/src/task-text-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/tasks-core/src/task-text-session")>();
  const { readTextFields } = await import("@/text-editor-core/docs-collab/docs-collab-text-fields");
  const { useSyncExternalStore, createElement } = await import("react");
  const holdContext = { hold: null as string | null, waiting: false };
  return {
    ...actual,
    useTaskTextSession: () => holdContext,
    TaskTextSession: ({
      L,
      children,
    }: {
      L: typeof defaultTasksLabels;
      children: React.ReactNode;
    }) => {
      const text = useSyncExternalStore(
        (notify) => {
          doc.current.on("update", notify);
          return () => doc.current.off("update", notify);
        },
        () => JSON.stringify(readTextFields(doc.current)),
      );
      holdContext.hold = actual.taskTextHold(JSON.parse(text), L);
      holdContext.waiting = waiting.current;
      return createElement(NoteCollabYDocProvider, {
        ydoc: doc.current,
        onLocalTitleEdit: scheduleSave,
        children,
      });
    },
  };
});

const bootstrap = createTasksAppBootstrap();
const L = defaultTasksLabels;
const collab = {
  userName: "Anna",
  urls: { room: "task:1:abc" },
  wire: {},
} as unknown as TaskTextCollabConfig;

function renderRoom(overrides: Partial<React.ComponentProps<typeof TasksDetailView>> = {}) {
  const task = bootstrap.data.tasks[0] as Task;
  const onSave = vi.fn();
  render(
    <TooltipProvider>
      <TasksDetailView
        task={task}
        L={L}
        taskLists={bootstrap.data.taskLists}
        allTaskLists={bootstrap.data.taskLists}
        readOnly={false}
        onSave={onSave}
        onToggleComplete={vi.fn()}
        textCollab={collab}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { task, onSave };
}

function seed(title: string, description: string) {
  doc.current.getText("note-title").insert(0, title);
  doc.current.getText("plain-body").insert(0, description);
}

describe("TasksDetailView in a live room", () => {
  beforeEach(() => {
    cleanup();
    doc.current = new Y.Doc();
    scheduleSave.mockReset();
    waiting.current = false;
    Element.prototype.scrollIntoView = vi.fn();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("binds the title and the notes to the document", () => {
    seed("Buy oat milk", "Two cartons");
    renderRoom();

    expect((screen.getByLabelText(L.addTaskName) as HTMLTextAreaElement).value).toBe(
      "Buy oat milk",
    );
    expect((screen.getByLabelText(L.descriptionLabel) as HTMLTextAreaElement).value).toBe(
      "Two cartons",
    );

    act(() => doc.current.getText("plain-body").insert(11, ", cold"));
    expect((screen.getByLabelText(L.descriptionLabel) as HTMLTextAreaElement).value).toBe(
      "Two cartons, cold",
    );
  });

  it("writes typing into the document and leaves it out of the autosave", () => {
    vi.useFakeTimers();
    seed("Buy milk", "");
    const { onSave } = renderRoom();

    fireEvent.change(screen.getByLabelText(L.descriptionLabel), { target: { value: "Cold" } });
    fireEvent.change(screen.getByLabelText(L.addTaskName), { target: { value: "Buy oat milk" } });
    act(() => vi.advanceTimersByTime(TASK_DETAIL_SAVE_DEBOUNCE_MS * 2));

    expect(doc.current.getText("plain-body").toString()).toBe("Cold");
    expect(doc.current.getText("note-title").toString()).toBe("Buy oat milk");
    expect(scheduleSave).toHaveBeenCalled();
    // The room saves the text: no autosave fired for it.
    expect(onSave).not.toHaveBeenCalled();

    // Another field still autosaves, told to leave the title and notes out.
    fireEvent.click(screen.getByRole("checkbox", { name: L.markComplete }));
    for (const [, , opts] of onSave.mock.calls) {
      expect(opts).toEqual({ skipText: true });
    }
  });

  it("holds the save with a reason while the title is blank", () => {
    seed("Buy milk", "");
    renderRoom();
    expect(screen.queryByText(L.liveTextTitleRequired)).toBeNull();

    fireEvent.change(screen.getByLabelText(L.addTaskName), { target: { value: "  " } });
    expect(screen.getByRole("status").textContent).toBe(L.liveTextTitleRequired);
  });

  it("caps the notes at the task API's limit", () => {
    seed("Buy milk", "");
    renderRoom();
    expect(screen.getByLabelText(L.descriptionLabel).getAttribute("maxlength")).toBe("8192");
  });

  it("keeps the fields read-only until the room has its first content", () => {
    waiting.current = true;
    renderRoom();

    expect(screen.getByLabelText(L.addTaskName).hasAttribute("readonly")).toBe(true);
    expect(screen.getByLabelText(L.descriptionLabel).hasAttribute("readonly")).toBe(true);
  });

  it("keeps the fields read-only while the task's room is looked up", () => {
    seed("Buy milk", "");
    renderRoom({ textCollab: undefined, textLookingUp: true });

    expect(screen.getByLabelText(L.addTaskName).hasAttribute("readonly")).toBe(true);
    expect(screen.getByLabelText(L.descriptionLabel).hasAttribute("readonly")).toBe(true);
  });

  it("shows read-only fields and a notice when access is lost", () => {
    seed("Buy milk", "Cold");
    renderRoom({ textAccessLost: true });

    expect(screen.getByText(L.liveTextAccessLost)).toBeTruthy();
    expect(screen.getByLabelText(L.addTaskName).hasAttribute("readonly")).toBe(true);
    expect(screen.getByLabelText(L.descriptionLabel).hasAttribute("readonly")).toBe(true);
  });
});
