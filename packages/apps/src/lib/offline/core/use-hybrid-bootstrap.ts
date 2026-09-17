import { useCallback, useEffect, useState } from "react";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";

type HybridPhase = "loading" | "ready" | "error";

export function useHybridBootstrap<T>({
  load,
  readCache,
}: {
  load: () => Promise<T>;
  readCache: () => Promise<T | null>;
}) {
  const [phase, setPhase] = useState<HybridPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [successVersion, setSuccessVersion] = useState(0);

  const applySuccess = useCallback((next: T) => {
    setData(next);
    setPhase("ready");
    setError(null);
    setSuccessVersion((v) => v + 1);
  }, []);

  const run = useCallback(() => {
    setPhase("loading");
    setError(null);
    void load()
      .then(applySuccess)
      .catch((e: unknown) => {
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      });
  }, [applySuccess, load]);

  useEffect(() => {
    let cancelled = false;
    void readCache().then((cached) => {
      if (cancelled) return;
      if (cached) {
        applySuccess(cached);
        if (readBrowserOnline()) {
          void load()
            .then((next) => {
              if (cancelled) return;
              // Cache already mounted the workspace — do not bump successVersion
              // (that remounts *App trees keyed on it and drops optimistic UI).
              setData(next);
              setPhase("ready");
              setError(null);
            })
            .catch(() => undefined);
        }
        return;
      }
      run();
    });
    return () => {
      cancelled = true;
    };
  }, [applySuccess, load, readCache, run]);

  const patchBootstrap = useCallback((updater: (prev: T | null) => T | null) => {
    setData(updater);
  }, []);

  return { phase, error, data, load: run, successVersion, patchBootstrap };
}
