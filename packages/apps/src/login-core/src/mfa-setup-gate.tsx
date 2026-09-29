import { useEffect, useState } from "react";
import { wgwFetch, wgwLogout, wgwReadJson } from "@/lib/api/wgw/http";
import { sessionWizardSource, type TotpWizardSource } from "@/lib/api/wgw/mfa-client";
import { subscribeMfaSetupRequired } from "@/lib/api/wgw/mfa-setup-signal";
import { TotpWizard } from "@/login-core/src/totp-wizard";

/**
 * Existing sessions that receive 403 `mfa_setup_required` enroll here.
 * This is not a new route, so the static shell allowlist stays unchanged.
 */
export function MfaSetupGate() {
  const [source, setSource] = useState<TotpWizardSource | null>(null);

  useEffect(() => {
    return subscribeMfaSetupRequired(() => {
      if (source) return;
      void (async () => {
        let username = "";
        try {
          const res = await wgwFetch("/me");
          if (res.ok) {
            const body = (await wgwReadJson(res)) as { username?: unknown };
            if (typeof body.username === "string") username = body.username;
          }
        } catch {
          username = "";
        }
        setSource(sessionWizardSource(username, true));
      })();
    });
  }, [source]);

  if (!source) return null;

  return (
    <div className="login-screen fixed inset-0 z-50 overflow-auto">
      <TotpWizard
        source={source}
        onFinished={() => setSource(null)}
        onLogout={() => {
          void wgwLogout().finally(() => {
            window.location.assign("/login");
          });
        }}
      />
    </div>
  );
}
