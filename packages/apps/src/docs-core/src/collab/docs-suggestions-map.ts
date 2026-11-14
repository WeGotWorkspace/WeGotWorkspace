import type * as Y from "yjs";
import { parseDocsSuggestionThread } from "./docs-suggestions/docs-suggestions-schema";
import {
  DOCS_SUGGESTION_THREADS_MAP_KEY,
  type DocsSuggestionThread,
} from "@/text-editor-core/docs-collab/docs-suggestions-types";

export { parseDocsSuggestionThread } from "./docs-suggestions/docs-suggestions-schema";

export function readDocsSuggestionThreadsFromMap(map: Y.Map<unknown>): DocsSuggestionThread[] {
  const threads: DocsSuggestionThread[] = [];
  map.forEach((value, key) => {
    const thread = parseDocsSuggestionThread(value, key);
    if (thread) threads.push(thread);
  });
  return threads;
}

export function getDocsSuggestionThreadsMap(ydoc: Y.Doc): Y.Map<unknown> {
  return ydoc.getMap(DOCS_SUGGESTION_THREADS_MAP_KEY);
}
