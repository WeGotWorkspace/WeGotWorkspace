import { useEffect, useRef, useState } from "react";

export type UseViewHeaderSearchQueryOptions = {
  searchValue?: string;
  onSearchInput?: (query: string) => void;
  searchDebounceMs?: number;
};

export type UseViewHeaderSearchQueryResult = {
  query: string;
  setQuery: (query: string) => void;
};

/**
 * Suite-wide ViewHeader search debounce: typing waits `searchDebounceMs`
 * (default 180ms); non-empty → empty flushes immediately; empty mount does
 * not emit `onSearchInput('')`.
 */
export function useViewHeaderSearchQuery({
  searchValue = "",
  onSearchInput,
  searchDebounceMs = 180,
}: UseViewHeaderSearchQueryOptions): UseViewHeaderSearchQueryResult {
  const [query, setQuery] = useState(searchValue);
  const previousQueryRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setQuery(searchValue);
  }, [searchValue]);

  useEffect(() => {
    if (!onSearchInput) return;
    const previous = previousQueryRef.current;
    previousQueryRef.current = query;
    const previousActive = previous !== undefined && previous.trim().length > 0;
    const nextEmpty = query.trim().length === 0;
    if (previous === undefined && nextEmpty) {
      return;
    }
    if (previousActive && nextEmpty) {
      onSearchInput(query);
      return;
    }
    const timeout = window.setTimeout(() => onSearchInput(query), searchDebounceMs);
    return () => window.clearTimeout(timeout);
  }, [query, onSearchInput, searchDebounceMs]);

  return { query, setQuery };
}
