import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type * as Y from "yjs";
import { CollabExternalWriteDialog } from "@/collab-ui/collab-external-write-dialog";
import { writeNoteTitle } from "@/lib/collab/docs-collab-document-title";
import type { Task } from "@/lib/models/tasks-types";
import { NoteCollabYDocProvider } from "@/note-detail-view/src/use-note-title-field";
import { useDocsCollab } from "@/text-editor-core/docs-collab";
import type { CollabSessionPresenceSource } from "@/text-editor-core/docs-collab";
import {
  readTextFields,
  readTextFieldsBase,
  sameTextFields,
  type TextFieldsText,
} from "@/text-editor-core/docs-collab/docs-collab-text-fields";
import {
  useDocsExternalWritePrompt,
  useDocsExternalWriteRequest,
} from "@/text-editor-core/docs-collab/use-docs-external-write-prompt";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import type { TaskTextCollabConfig } from "@/tasks-core/src/use-task-text-collab";

/** The limits the task API holds a title and a description to (spec.md, Decisions). */
export const TASK_TITLE_MAX_LENGTH = 4096;
export const TASK_DESCRIPTION_MAX_LENGTH = 8192;

/** Why the room does not save its text right now, or null when it can. */
export function taskTextHold(text: TextFieldsText, L: TasksUILabels): string | null {
  if (text.title.trim() === "") return L.liveTextTitleRequired;
  if (text.title.length > TASK_TITLE_MAX_LENGTH) return L.liveTextTooLong;
  if (text.description.length > TASK_DESCRIPTION_MAX_LENGTH) return L.liveTextTooLong;
  return null;
}

type TaskTextContextValue = {
  hold: string | null;
  /**
   * The room has not taken its first content yet (the server text or a peer's
   * copy). Typing now would land in an empty document (#2056): the fields wait.
   */
  waiting: boolean;
};
const TaskTextContext = createContext<TaskTextContextValue | null>(null);

/** Inside a {@link TaskTextSession}: why the save waits, and whether typing does. Null outside a room. */
export function useTaskTextSession(): TaskTextContextValue | null {
  return useContext(TaskTextContext);
}

const NO_TEXT: TextFieldsText = { title: "", description: "" };

function useDocText(ydoc: Y.Doc | null): TextFieldsText {
  const last = useRef<TextFieldsText>(NO_TEXT);
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!ydoc) return () => {};
      ydoc.on("update", notify);
      return () => ydoc.off("update", notify);
    },
    [ydoc],
  );
  const read = useCallback(() => {
    if (!ydoc) return NO_TEXT;
    const next = readTextFields(ydoc);
    // The same object while the text is the same: no render loop.
    if (sameTextFields(next, last.current)) return last.current;
    last.current = next;
    return next;
  }, [ydoc]);
  return useSyncExternalStore(subscribe, read, () => NO_TEXT);
}

/**
 * The open task's title and description in one live room (#2208). The title
 * binds through `NoteDetailView` (`note-title`), the description through
 * {@link TaskDescriptionField} (`plain-body`). Outside edits, the question and
 * the save are the shared session's; Tasks adds the labels, the hold for a
 * blank or oversized field, and the re-read when a push names other text.
 */
export function TaskTextSession({
  collab,
  task,
  L,
  onLiveText,
  onPresence,
  children,
}: {
  collab: TaskTextCollabConfig;
  task: Task;
  L: TasksUILabels;
  /**
   * The text the document holds, for the list row, and whether the server
   * does not have it yet (the access-lost park). Projection only: never a save.
   */
  onLiveText?: (taskId: string, text: TextFieldsText, unsaved: boolean) => void;
  /** Who is in the room, for the detail header; null when the room is left. */
  onPresence?: (taskId: string, presence: CollabSessionPresenceSource | null) => void;
  children: ReactNode;
}) {
  const ydocRef = useRef<Y.Doc | null>(null);
  const LRef = useRef(L);
  LRef.current = L;
  const urls = useMemo(
    () => ({
      ...collab.urls,
      holdSave: () => {
        const ydoc = ydocRef.current;
        return ydoc ? taskTextHold(readTextFields(ydoc), LRef.current) !== null : false;
      },
    }),
    [collab.urls],
  );
  const request = useDocsExternalWriteRequest(urls);
  const session = useDocsCollab({
    userName: collab.userName,
    autoJoin: true,
    urls: request.urls,
    wire: collab.wire,
    seedContent: task.description ?? "",
  });
  const ydoc = session.session?.ydoc ?? null;
  ydocRef.current = ydoc;
  const prompt = useDocsExternalWritePrompt({
    request,
    ydoc,
    resolveExternalWrite: session.resolveExternalWrite,
  });

  const text = useDocText(ydoc);
  const hold = ydoc && session.joined ? taskTextHold(text, L) : null;
  const waiting = !ydoc || !session.joined || session.awaitingContent;

  const onLiveTextRef = useRef(onLiveText);
  onLiveTextRef.current = onLiveText;
  const taskId = task.id;
  const { lastSavedAt } = session;
  useEffect(() => {
    if (!ydoc || !session.joined || text === NO_TEXT) return;
    const base = readTextFieldsBase(ydoc);
    onLiveTextRef.current?.(taskId, text, !base || !sameTextFields(base, text));
  }, [lastSavedAt, session.joined, taskId, text, ydoc]);

  const onPresenceRef = useRef(onPresence);
  onPresenceRef.current = onPresence;
  const { joined, peers, connectingPeers, warningPeers } = session;
  const presenceSession = joined ? session.session : null;
  useEffect(() => {
    onPresenceRef.current?.(
      taskId,
      presenceSession ? { session: presenceSession, peers, connectingPeers, warningPeers } : null,
    );
  }, [connectingPeers, peers, presenceSession, taskId, warningPeers]);
  useEffect(() => () => onPresenceRef.current?.(taskId, null), [taskId]);

  // A push whose title or description differs from the document: re-read the
  // server (spec.md, The re-read). Equal text, our own save included, does nothing.
  const { rereadServer } = session;
  const served = useMemo(
    () => ({ title: task.title ?? "", description: task.description ?? "" }),
    [task.description, task.title],
  );
  useEffect(() => {
    if (!ydoc || !session.joined) return;
    if (sameTextFields(served, readTextFields(ydoc))) return;
    void rereadServer().catch(() => {});
    // Only a new served text starts a re-read, not the person's own typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [served, session.joined]);

  // Leaving with a blank title: the last writer in the room puts the title the
  // document last took from the server back (spec.md, Blank title). Before the
  // session's own teardown, which runs as a passive effect.
  const peersRef = useRef(0);
  peersRef.current = session.peers.length;
  useLayoutEffect(() => {
    if (!ydoc) return;
    return () => {
      if (peersRef.current > 0) return;
      const current = readTextFields(ydoc);
      if (current.title.trim() !== "") return;
      const base = readTextFieldsBase(ydoc)?.title ?? served.title;
      if (base.trim() === "") return;
      writeNoteTitle(ydoc, base);
      // Nothing saves, so no push puts the stored title back on the list row.
      onLiveTextRef.current?.(taskId, readTextFields(ydoc), false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc]);

  const value = useMemo(() => ({ hold, waiting }), [hold, waiting]);
  return (
    <NoteCollabYDocProvider
      ydoc={ydoc}
      awareness={session.session?.awareness ?? null}
      localUserName={session.session?.user.name}
      onLocalTitleEdit={session.scheduleSave}
    >
      <TaskTextContext.Provider value={value}>
        {children}
        <CollabExternalWriteDialog
          open={prompt.open}
          name={text.title || served.title}
          busy={prompt.busy}
          keepLocalDisabled={prompt.keepLocalDisabled}
          labels={L.liveTextExternalWrite}
          onKeepLocal={prompt.keepLocal}
          onUseOutside={prompt.useOutside}
        />
      </TaskTextContext.Provider>
    </NoteCollabYDocProvider>
  );
}
