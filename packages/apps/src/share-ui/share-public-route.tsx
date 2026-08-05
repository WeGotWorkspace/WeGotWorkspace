import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { createDriveShareSession, ShareSessionError } from "@/lib/api/wgw/drive-share-sessions";
import {
  wgwClearGuestShareAccess,
  wgwEstablishGuestShareSession,
  wgwEstablishMockSession,
  wgwLiveApiEnabled,
  wgwPersistGuestShareToken,
} from "@/lib/api/wgw/http";
import { shareDestination, shareDestinationHref } from "@/share-ui/share-destination";
import { downloadSharedDriveFile } from "@/share-ui/share-file-download";
import { shareLabels } from "@/share-ui/share-labels";
import { SharePublicView, type SharePublicViewPhase } from "@/share-ui/share-public-view";

const MOCK_SHARE_PATH = "/users/demo.user/Projects/report.md";

export function SharePublicRoute() {
  const navigate = useNavigate();
  const { token } = useParams({ strict: false }) as { token?: string };
  const [phase, setPhase] = useState<SharePublicViewPhase>("loading");
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

        // Always exchange a fresh share session. A prior guest JWT may still be in
        // storage after the owner rotates the password (DB session revoked).
        wgwClearGuestShareAccess();
        wgwPersistGuestShareToken(shareToken);

        const session = await createDriveShareSession(shareToken, sharePassword, signal);
        if (signal?.aborted) return;
        wgwEstablishGuestShareSession(
          {
            access_token: session.access_token,
            expires_in: session.expires_in,
          },
          shareToken,
          session.share.path,
        );
        const destination = shareDestination(session.share.path);
        if (destination.kind === "download") {
          await downloadSharedDriveFile(destination.apiPath, signal);
          if (signal?.aborted) return;
          setPhase("downloaded");
          return;
        }
        const route = destination.route;
        await navigate({ to: route.to, search: route.search });
      } catch (cause) {
        if (signal?.aborted) return;
        if (cause instanceof ShareSessionError) {
          if (cause.code === "share_password_required") {
            setPhase("password");
            setErrorMessage("");
            return;
          }
          if (cause.code === "share_password_invalid") {
            setPhase("password");
            setErrorMessage(cause.message || shareLabels.publicLinkPasswordRequired);
            return;
          }
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

  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const shareToken = token?.trim();
    if (!shareToken) return;
    void openShare(shareToken, password);
  };

  return (
    <SharePublicView
      phase={phase}
      password={password}
      errorMessage={errorMessage}
      submitting={submitting}
      onPasswordChange={setPassword}
      onPasswordSubmit={submitPassword}
    />
  );
}
