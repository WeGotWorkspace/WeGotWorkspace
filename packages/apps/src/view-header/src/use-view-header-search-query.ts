import { useEffect, useRef, useState } from "react";

export type UseViewHeaderSearchQueryOptions = {
  searchValue?: string;
  onSearchInput?: (query: string) => void;
  searchDebounceMs?: number;
  /** Default 1. Calendar passes 3 so 1–2 chars never lock search. */
  searchMinLength?: number;
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
function isActiveQuery(query: string, minLength: number): boolean {
  return query.trim().length >= minLength;
}

export function useViewHeaderSearchQuery({
  searchValue = "",
  onSearchInput,
  searchDebounceMs = 180,
  searchMinLength = 1,
}: UseViewHeaderSearchQueryOptions): UseViewHeaderSearchQueryResult {
  const [query, setQuery] = useState(searchValue);
  const previousQueryRef = useRef<string | undefined>(undefined);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    const local = queryRef.current;
    if (
      searchMinLength > 1 &&
      !isActiveQuery(searchValue, searchMinLength) &&
      local.trim().length > 0 &&
      !isActiveQuery(local, searchMinLength)
    ) {
      return;
    }
    setQuery(searchValue);
  }, [searchValue, searchMinLength]);

  useEffect(() => {
    if (!onSearchInput) return;
    const previous = previousQueryRef.current;
    previousQueryRef.current = query;
    const previousActive = previous !== undefined && isActiveQuery(previous, searchMinLength);
    const nextActive = isActiveQuery(query, searchMinLength);
    if (previous === undefined && !nextActive) {
      return;
    }
    if (previousActive && !nextActive) {
      onSearchInput("");
      return;
    }
    if (!nextActive) {
      return;
    }
    const timeout = window.setTimeout(() => onSearchInput(query), searchDebounceMs);
    return () => window.clearTimeout(timeout);
  }, [query, onSearchInput, searchDebounceMs, searchMinLength]);

  return { query, setQuery };
}
