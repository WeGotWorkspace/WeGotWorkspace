import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import "@/text-editor-core/src/text-editor-track-changes-augmentation";
import {
  editorHasTrackChanges,
  getDocsTrackChangeGroups,
  scrollTrackChangeIntoView,
  type DocsTrackChangeGroup,
} from "@/text-editor-core/src/text-editor-track-changes";
import type * as Y from "yjs";
import type { DocsCommentAuthor } from "./docs-comments-types";
import { createDocsThreadsMemory, type DocsThreadsMemoryClient } from "./docs-threads-memory";
import type { DocsThreadsClient } from "./docs-threads-types";
import type { DocsSuggestionWithThread } from "./docs-suggestions-types";
import { useDocsSuggestionsActive } from "./use-docs-suggestions-active";
import { useDocsSuggestionsMutations } from "./use-docs-suggestions-mutations";
import { useDocsThreadsSource, type DocsThreadsSource } from "./use-docs-threads-source";

export type UseDocsSuggestionsOptions = {
  ydoc: Y.Doc | null;
  currentUser: DocsCommentAuthor;
  docPath?: string | null;
  threadsClient?: DocsThreadsClient | null;
  threadsSource?: DocsThreadsSource;
  pollThreads?: boolean;
};

export type UseDocsSuggestionsResult = {
  suggestions: DocsSuggestionWithThread[];
  activeChangeId: string | null;
  selectSuggestion: (changeId: string) => void;
  clearActiveSuggestion: () => void;
  activateSuggestionFromMark: (changeId: string) => void;
  acceptSuggestion: (changeId: string) => void;
  rejectSuggestion: (changeId: string) => void;
  addReply: (changeId: string, body: string) => void;
  toggleReaction: (changeId: string, emoji: string) => void;
};

function mergeSuggestionWithThread(
  suggestion: DocsTrackChangeGroup,
  threadMap: Map<
    string,
    {
      messages: DocsSuggestionWithThread["messages"];
      reactions?: DocsSuggestionWithThread["reactions"];
    }
  >,
): DocsSuggestionWithThread {
  const thread = threadMap.get(suggestion.changeId);
  return {
    ...suggestion,
    messages: thread?.messages ?? [],
    reactions: thread?.reactions,
  };
}

const FALLBACK_DOC_PATH = "/users/bob/docs/plan.md";

function isMemoryClient(client: DocsThreadsClient): client is DocsThreadsMemoryClient {
  return "setActor" in client;
}

export function useDocsSuggestions(
  editor: Editor | null,
  options?: UseDocsSuggestionsOptions,
): UseDocsSuggestionsResult {
  const currentUser = options?.currentUser ?? { id: "", name: "" };
  const docPath = options?.docPath ?? null;
  const threadsClient = options?.threadsClient;
  const threadsSource = options?.threadsSource;

  const fallbackClient = useRef<DocsThreadsClient | null>(null);
  if (fallbackClient.current == null && threadsClient == null) {
    fallbackClient.current = createDocsThreadsMemory(docPath ?? FALLBACK_DOC_PATH, currentUser);
  }
  const resolvedClient = threadsClient ?? fallbackClient.current;
  if (resolvedClient && isMemoryClient(resolvedClient)) {
    resolvedClient.setActor(currentUser);
  }

  const ownedSource = useDocsThreadsSource({
    client: threadsSource ? null : resolvedClient,
    path: threadsSource ? null : (docPath ?? FALLBACK_DOC_PATH),
    poll: Boolean(options?.pollThreads && !threadsSource),
  });
  const source = threadsSource ?? ownedSource;

  const [editorSuggestions, setEditorSuggestions] = useState<DocsTrackChangeGroup[]>([]);
  const { activeChangeId, setActiveChangeId, clearActiveSuggestion } =
    useDocsSuggestionsActive(editor);
  const threads = source.suggestions;

  const threadMap = useMemo(() => {
    const map = new Map<
      string,
      {
        messages: DocsSuggestionWithThread["messages"];
        reactions?: DocsSuggestionWithThread["reactions"];
      }
    >();
    for (const thread of threads) {
      map.set(thread.changeId, {
        messages: thread.messages,
        reactions: thread.reactions,
      });
    }
    return map;
  }, [threads]);

  const suggestions = useMemo(
    () => editorSuggestions.map((suggestion) => mergeSuggestionWithThread(suggestion, threadMap)),
    [editorSuggestions, threadMap],
  );

  useEffect(() => {
    if (!editor || !editorHasTrackChanges(editor)) {
      setEditorSuggestions([]);
      return;
    }

    const syncSuggestions = () => {
      const next = getDocsTrackChangeGroups(editor);
      setEditorSuggestions(next);
      setActiveChangeId((current) =>
        current && next.some((item) => item.changeId === current) ? current : null,
      );
    };

    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction?.docChanged) return;
      syncSuggestions();
    };

    syncSuggestions();
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor, setActiveChangeId]);

  const { addReply, toggleReaction, archiveSuggestion } = useDocsSuggestionsMutations({
    client: resolvedClient,
    path: docPath ?? FALLBACK_DOC_PATH,
    source,
    currentUser,
  });

  useEffect(() => {
    if (!editor || !editorHasTrackChanges(editor) || !resolvedClient) return;
    const activeChangeIds = new Set(getDocsTrackChangeGroups(editor).map((item) => item.changeId));
    for (const thread of source.fileThreads) {
      if (thread.kind !== "suggestion" || thread.archived) continue;
      if (!thread.changeId || activeChangeIds.has(thread.changeId)) continue;
      archiveSuggestion(thread.changeId);
    }
  }, [archiveSuggestion, editor, editorSuggestions, resolvedClient, source.fileThreads]);

  const selectSuggestion = useCallback(
    (changeId: string) => {
      setActiveChangeId(changeId);
    },
    [setActiveChangeId],
  );

  const activateSuggestionFromMark = useCallback(
    (changeId: string) => {
      setActiveChangeId(changeId);
      if (!editor) return;
      scrollTrackChangeIntoView(editor, changeId);
    },
    [editor, setActiveChangeId],
  );

  const acceptSuggestion = useCallback(
    (changeId: string) => {
      if (!editor) return;
      editor.commands.acceptChange(changeId);
      archiveSuggestion(changeId);
      setActiveChangeId((current) => (current === changeId ? null : current));
    },
    [archiveSuggestion, editor, setActiveChangeId],
  );

  const rejectSuggestion = useCallback(
    (changeId: string) => {
      if (!editor) return;
      editor.commands.rejectChange(changeId);
      archiveSuggestion(changeId);
      setActiveChangeId((current) => (current === changeId ? null : current));
    },
    [archiveSuggestion, editor, setActiveChangeId],
  );

  return {
    suggestions,
    activeChangeId,
    selectSuggestion,
    clearActiveSuggestion,
    activateSuggestionFromMark,
    acceptSuggestion,
    rejectSuggestion,
    addReply,
    toggleReaction,
  };
}
