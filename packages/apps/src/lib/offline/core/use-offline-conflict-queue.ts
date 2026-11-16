import { useCallback, useEffect, useState } from "react";

type SetConflictListener<T> = (listener: ((ids: T[]) => void) | undefined) => void;

type UseOfflineConflictQueueArgs<T> = {
  setListener: SetConflictListener<T>;
  onConflicts?: (ids: T[]) => void;
};

export function useOfflineConflictQueue<T>({
  setListener,
  onConflicts,
}: UseOfflineConflictQueueArgs<T>): {
  conflicts: T[];
  clearConflicts: () => void;
} {
  const [conflicts, setConflicts] = useState<T[]>([]);

  useEffect(() => {
    const listener = (ids: T[]) => {
      setConflicts(ids);
      onConflicts?.(ids);
    };
    setListener(listener);
    return () => setListener(undefined);
  }, [onConflicts, setListener]);

  const clearConflicts = useCallback(() => setConflicts([]), []);

  return { conflicts, clearConflicts };
}
