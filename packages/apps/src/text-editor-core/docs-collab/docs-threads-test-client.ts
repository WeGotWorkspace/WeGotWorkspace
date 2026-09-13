/** @vitest-environment jsdom */
import { useMemo } from "react";
import type { Editor } from "@tiptap/react";
import type * as Y from "yjs";
import { getDocsCommentsMap, readDocsCommentThreadsFromMap } from "./docs-comments-map";
import { getDocsSuggestionThreadsMap, parseDocsSuggestionThread } from "./docs-suggestions-map";
import type { DocsCommentAuthor } from "./docs-comments-types";
import { createDocsThreadsMemory } from "./docs-threads-memory";
import { useDocsComments, type UseDocsCommentsOptions } from "./use-docs-comments";
import { useDocsSuggestions, type UseDocsSuggestionsOptions } from "./use-docs-suggestions";

export const DOCS_THREADS_TEST_PATH = "/users/bob/docs/plan.md";

function clientFromYdoc(ydoc: Y.Doc | null, currentUser: DocsCommentAuthor) {
  const client = createDocsThreadsMemory(DOCS_THREADS_TEST_PATH, currentUser);
  if (!ydoc) return client;
  for (const thread of readDocsCommentThreadsFromMap(getDocsCommentsMap(ydoc))) {
    client.seedComment(thread);
  }
  const suggestionMap = getDocsSuggestionThreadsMap(ydoc);
  suggestionMap.forEach((value, changeId) => {
    const thread = parseDocsSuggestionThread(value, changeId);
    if (thread) client.seedSuggestion(thread);
  });
  return client;
}

/** Hook wrapper: copy Y.Map fixtures into the in-memory REST client (tests only). */
export function useTestDocsComments(options: UseDocsCommentsOptions) {
  const client = useMemo(
    () => options.threadsClient ?? clientFromYdoc(options.ydoc, options.currentUser),
    // Fixture maps are seeded before the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.threadsClient, options.ydoc],
  );
  return useDocsComments({
    ...options,
    threadsClient: client,
    docPath: options.docPath ?? DOCS_THREADS_TEST_PATH,
  });
}

export function useTestDocsSuggestions(editor: Editor | null, options?: UseDocsSuggestionsOptions) {
  const currentUser = options?.currentUser ?? { id: "u-1", name: "Alex" };
  const client = useMemo(
    () => options?.threadsClient ?? clientFromYdoc(options?.ydoc ?? null, currentUser),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options?.threadsClient, options?.ydoc],
  );
  return useDocsSuggestions(editor, {
    ...options,
    ydoc: options?.ydoc ?? null,
    currentUser,
    threadsClient: client,
    docPath: options?.docPath ?? DOCS_THREADS_TEST_PATH,
  });
}
