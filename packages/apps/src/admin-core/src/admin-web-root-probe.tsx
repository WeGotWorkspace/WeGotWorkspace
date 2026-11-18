import { useEffect, useState } from "react";

const PROBE_BODY = "wgw-content-probe";

const WEB_ROOT_PROBE_DIRECTORIES = ["wgw-content", "packages", "wgw-plugins"] as const;

/** Same-origin canaries, prefixed with the Vite base so a subdirectory install still hits its own tree. */
export function webRootProbeUrls(base: string = import.meta.env.BASE_URL): string[] {
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;

  return WEB_ROOT_PROBE_DIRECTORIES.map((directory) => `${prefix}/${directory}/.probe`);
}

async function probeDirectory(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      return null;
    }
    const body = await response.text();
    if (!body.includes(PROBE_BODY)) {
      return null;
    }
    const match = /\/(wgw-content|packages|wgw-plugins)\/\.probe$/.exec(url);

    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Directories of this install that the web serves (should be none); empty until probed. */
export function useWebRootProbe(): string[] {
  const [reachable, setReachable] = useState<string[]>([]);

  useEffect(() => {
    if (typeof fetch !== "function") {
      return;
    }

    let cancelled = false;
    Promise.all(webRootProbeUrls().map((url) => probeDirectory(url)))
      .then((names) => {
        if (!cancelled) {
          setReachable(names.filter((name): name is string => name !== null));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return reachable;
}
