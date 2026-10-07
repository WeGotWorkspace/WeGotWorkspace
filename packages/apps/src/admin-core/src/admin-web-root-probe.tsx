import { useEffect, useState } from "react";
import { Callout } from "@/callout/src/callout";

const PROBE_URL = "/wgw-content/.probe";
const PROBE_BODY = "wgw-content-probe";

export function AdminWebRootProbe() {
  const [exposed, setExposed] = useState(false);

  useEffect(() => {
    if (typeof fetch !== "function") {
      return;
    }

    let cancelled = false;
    fetch(PROBE_URL, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }
        const body = await response.text();
        if (!cancelled && body.includes(PROBE_BODY)) {
          setExposed(true);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  if (!exposed) {
    return null;
  }

  return (
    <div className="admin-security-warnings">
      <Callout
        severity="error"
        title="Security warning"
        message="wgw-content is reachable from the web. The data directory, including the database and private keys, can be downloaded."
      />
    </div>
  );
}
