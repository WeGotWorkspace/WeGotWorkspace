import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "@/button/src/button";
import { createDriveShareSession, ShareSessionError } from "@/lib/api/wgw/drive-share-sessions";
import {
  wgwEstablishGuestShareSession,
  wgwEstablishMockSession,
  wgwLiveApiEnabled,
} from "@/lib/api/wgw/http";
import { shareDestinationHref, shareDestinationRoute } from "@/share-ui/share-destination";
import { shareLabels } from "@/share-ui/share-labels";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { WorkspaceShellHeader } from "@/workspace-shell/src/workspace-shell-header";
import "@/share-ui/share-ui.css";

type SharePublicRoutePhase = "loading" | "password" | "error";

const MOCK_SHARE_PATH = "/users/demo.user/Projects/report.md";

export function SharePublicRoute() {
  const navigate = useNavigate();
  const { token } = useParams({ strict: false }) as { token?: string };
  const [phase, setPhase] = useState<SharePublicRoutePhase>("loading");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const openShare = useCallback(
    async (shareToken: string, sharePassword?: string, signal?: AbortSignal) => {
      setSubmitting(true);
      setErrorMessage("");
      try {
        if (!wgwLiveApiEnabled()) {
          wgwEstablishMockSession();
          if (signal?.aborted) return;
          await navigate({ to: shareDestinationHref(MOCK_SHARE_PATH) });
          return;
        }

        const session = await createDriveShareSession(shareToken, sharePassword, signal);
        if (signal?.aborted) return;
        wgwEstablishGuestShareSession(
          {
            access_token: session.access_token,
            expires_in: session.expires_in,
          },
          shareToken,
        );
        const destination = shareDestinationRoute(session.share.path);
        await navigate({ to: destination.to, search: destination.search });
      } catch (cause) {
        if (signal?.aborted) return;
        if (cause instanceof ShareSessionError && cause.status === 401) {
          setPhase("password");
          setErrorMessage(shareLabels.publicLinkPasswordRequired);
          return;
        }
        const message =
          cause instanceof Error && cause.message.trim()
            ? cause.message.trim()
            : shareLabels.publicLinkOpenError;
        setPhase("error");
        setErrorMessage(message);
      } finally {
        if (!signal?.aborted) {
          setSubmitting(false);
        }
      }
    },
    [navigate],
  );

  useEffect(() => {
    const shareToken = token?.trim();
    if (!shareToken) {
      setPhase("error");
      setErrorMessage(shareLabels.publicLinkMissingToken);
      return;
    }
    const controller = new AbortController();
    void openShare(shareToken, undefined, controller.signal);
    return () => controller.abort();
  }, [openShare, token]);

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const shareToken = token?.trim();
    if (!shareToken) return;
    await openShare(shareToken, password);
  };

  return (
    <main className="share-public-route min-h-screen">
      <section className="flex min-h-screen flex-col">
        <WorkspaceShellHeader appSwitchDisabled appSwitchSubtitle="Shared link" />

        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md text-center">
            {phase === "loading" ? (
              <>
                <h1 className="share-public-route__title">{shareLabels.publicLinkOpeningTitle}</h1>
                <p className="share-public-route__hint">{shareLabels.publicLinkOpeningHint}</p>
              </>
            ) : null}

            {phase === "password" ? (
              <>
                <h1 className="share-public-route__title">{shareLabels.publicLinkPasswordTitle}</h1>
                <p className="share-public-route__hint">{shareLabels.publicLinkPasswordHint}</p>
                {errorMessage ? (
                  <p className="share-public-route__error" role="alert">
                    {errorMessage}
                  </p>
                ) : null}
                <form
                  className="share-public-route__form"
                  onSubmit={(event) => void submitPassword(event)}
                >
                  <FieldLabelRow label={shareLabels.requirePassword}>
                    <Input
                      type="password"
                      value={password}
                      autoComplete="current-password"
                      placeholder={shareLabels.passwordPlaceholder}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </FieldLabelRow>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={submitting || !password.trim()}
                  >
                    {submitting
                      ? shareLabels.publicLinkOpeningTitle
                      : shareLabels.publicLinkContinue}
                  </Button>
                </form>
              </>
            ) : null}

            {phase === "error" ? (
              <>
                <h1 className="share-public-route__title">{shareLabels.publicLinkErrorTitle}</h1>
                <p className="share-public-route__error" role="alert">
                  {errorMessage || shareLabels.publicLinkOpenError}
                </p>
                <p className="share-public-route__hint">
                  {shareLabels.publicLinkErrorHint}{" "}
                  <a className="share-public-route__inline-link" href="/login">
                    {shareLabels.publicLinkSignIn}
                  </a>
                </p>
              </>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
