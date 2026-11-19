import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { Task } from "@/lib/models/tasks-types";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TaskTextSession } from "@/tasks-core/src/task-text-session";
import type { TaskTextCollabConfig } from "@/tasks-core/src/use-task-text-collab";
import {
  TEXT_FIELDS_BODY,
  TEXT_FIELDS_META,
  TEXT_FIELDS_TITLE,
} from "@/text-editor-core/docs-collab/docs-collab-text-fields";

// The shared session is tested in text-editor-core: a stand-in hands this
// component a joined document, so the test covers what Tasks adds on leaving.
const doc = { current: new Y.Doc() };
const scheduleSave = vi.fn();
vi.mock("@/text-editor-core/docs-collab", () => ({
  useDocsCollab: () => ({
    session: { ydoc: doc.current, awareness: null, user: { name: "Anna" } },
    joined: true,
    awaitingContent: false,
    peers: [],
    lastSavedAt: null,
    scheduleSave: () => scheduleSave(),
    rereadServer: vi.fn(() => Promise.resolve()),
    resolveExternalWrite: vi.fn(),
  }),
}));
vi.mock("@/text-editor-core/docs-collab/use-docs-external-write-prompt", () => ({
  useDocsExternalWriteRequest: (urls: unknown) => ({ urls }),
  useDocsExternalWritePrompt: () => ({
    open: false,
    busy: false,
    keepLocalDisabled: false,
    keepLocal: vi.fn(),
    useOutside: vi.fn(),
  }),
}));

const collab = {
  userName: "Anna",
  urls: { room: "task:1:abc" },
  wire: {},
} as unknown as TaskTextCollabConfig;

describe("TaskTextSession leaving with a blank title", () => {
  afterEach(cleanup);

  it("projects the stored title back onto the list row", () => {
    doc.current = new Y.Doc();
    doc.current.getText(TEXT_FIELDS_TITLE).insert(0, "   ");
    doc.current.getText(TEXT_FIELDS_BODY).insert(0, "Two cartons");
    doc.current
      .getMap(TEXT_FIELDS_META)
      .set("base", { title: "Buy milk", description: "Two cartons", contentTag: null, vector: {} });
    const onLiveText = vi.fn();
    const task = { id: "t1", title: "   ", description: "Two cartons" } as unknown as Task;

    const view = render(
      <TaskTextSession collab={collab} task={task} L={defaultTasksLabels} onLiveText={onLiveText}>
        <div />
      </TaskTextSession>,
    );
    // While open, the blank title was projected onto the row.
    expect(onLiveText).toHaveBeenLastCalledWith(
      "t1",
      expect.objectContaining({ title: "   " }),
      true,
    );

    view.unmount();
    expect(onLiveText).toHaveBeenLastCalledWith(
      "t1",
      { title: "Buy milk", description: "Two cartons" },
      false,
    );
    expect(scheduleSave).not.toHaveBeenCalled();
  });

  it("saves notes the blank title held back, with the stored title", () => {
    scheduleSave.mockClear();
    doc.current = new Y.Doc();
    doc.current.getText(TEXT_FIELDS_TITLE).insert(0, "");
    doc.current.getText(TEXT_FIELDS_BODY).insert(0, "Three cartons");
    doc.current
      .getMap(TEXT_FIELDS_META)
      .set("base", { title: "Buy milk", description: "Two cartons", contentTag: null, vector: {} });
    const onLiveText = vi.fn();
    const task = { id: "t1", title: "Buy milk", description: "Two cartons" } as unknown as Task;

    const view = render(
      <TaskTextSession collab={collab} task={task} L={defaultTasksLabels} onLiveText={onLiveText}>
        <div />
      </TaskTextSession>,
    );
    view.unmount();

    // The leave saves what the save timer holds: title and notes together.
    expect(scheduleSave).toHaveBeenCalledTimes(1);
    expect(onLiveText).toHaveBeenLastCalledWith(
      "t1",
      { title: "Buy milk", description: "Three cartons" },
      true,
    );
  });
});
