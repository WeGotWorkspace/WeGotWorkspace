import type { DocsSuggestionThread } from "@/text-editor-core/docs-collab/docs-suggestions-types";

export function useDocsSuggestionsSync(threads: DocsSuggestionThread[]): DocsSuggestionThread[] {
  return threads;
}
