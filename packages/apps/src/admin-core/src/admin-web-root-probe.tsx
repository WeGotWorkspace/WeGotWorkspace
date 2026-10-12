import { useEffect, useState } from "react";
import { Callout } from "@/callout/src/callout";

const PROBE_BODY = "wgw-content-probe";

const WEB_ROOT_PROBE_DIRECTORIES = ["wgw-content", "packages", "wgw-plugins"] as const;

/** Same-origin canaries, prefixed with the Vite base so a subdirectory install still hits its own tree. */
export function webRootProbeUrls(base: string = import.meta.env.BASE_URL): string[] {
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;

  return WEB_ROOT_PROBE_DIRECTORIES.map((directory) => `${prefix}/${directory}/.probe`);
}

function reachableMessage(directories: readonly string[]): string {
  if (directories.length === 1 && directories[0] === "wgw-content") {
    return "wgw-content is reachable from the web. The data directory, including the database and private keys, can be downloaded.";
  }

  if (directories.length === 1) {
    return `${directories[0]} is reachable from the web.`;
  }

  return `${directories.join(", ")} are reachable from the web.`;
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

export function AdminWebRootProbe() {
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

  if (reachable.length === 0) {
    return null;
  }

  return (
    <div className="admin-security-warnings">
      <Callout severity="error" title="Security warning" message={reachableMessage(reachable)} />
    </div>
  );
}
