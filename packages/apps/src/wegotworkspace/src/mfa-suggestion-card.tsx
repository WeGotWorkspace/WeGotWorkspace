import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/button/src/button";
import { fetchMfaAccount, snoozeMfaSuggestion, type MfaAccount } from "@/lib/api/wgw/mfa-client";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";

type MfaSuggestionCardProps = {
  account?: MfaAccount | null;
  onLater?: () => void;
  onEnable?: () => void;
};

/** Dismissible home note. It does not block the app grid. */
export function MfaSuggestionCard({ account, onLater, onEnable }: MfaSuggestionCardProps) {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(account ? account.suggest && !account.required : false);
  const [loaded, setLoaded] = useState(account !== undefined);

  useEffect(() => {
    if (account !== undefined || !wgwLiveApiEnabled()) return;
    let cancelled = false;
    void fetchMfaAccount().then((next) => {
      if (cancelled || !next) return;
      setVisible(next.suggest && !next.required && !next.enabled);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [account]);

  if (!loaded || !visible) return null;

  return (
    <aside
      className="w-full max-w-5xl rounded-2xl border px-4 py-3 text-sm"
      aria-label="Two-factor suggestion"
    >
      <p>Turn on two-factor authentication for this account. You can do it later.</p>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          label="Set up"
          onClick={() => {
            if (onEnable) onEnable();
            else void navigate({ to: "/settings/$section", params: { section: "security" } });
          }}
        />
        <Button
          type="button"
          variant="outline"
          label="Later"
          onClick={() => {
            setVisible(false);
            if (onLater) onLater();
            else void snoozeMfaSuggestion();
          }}
        />
      </div>
    </aside>
  );
}
