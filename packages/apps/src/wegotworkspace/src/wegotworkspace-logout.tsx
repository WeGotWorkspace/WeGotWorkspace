import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  wgwCompleteLogoutNavigation,
  wgwIsGuestSession,
  type WgwLogoutNavigation,
} from "@/lib/api/wgw/http";
import { probeBrowserReachable } from "@/lib/offline/core/browser-online";
import {
  countDiscardedQueuedUploads,
  countDiscardedUnsyncedChanges,
} from "@/lib/offline/core/offline-wipe";
import { Button } from "@/button/src/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";

type WeGotWorkspaceLogoutProps = {
  countUnsyncedChanges?: () => Promise<number>;
  /** Files still in the Drive upload queue; the wipe drops them (#1522). */
  countQueuedUploads?: () => Promise<number>;
  isGuestSession?: () => boolean;
  isOnline?: () => boolean | Promise<boolean>;
  completeLogout?: () => Promise<WgwLogoutNavigation>;
};

// Offline, the revoke step fails and nothing retries it later.
const OFFLINE_LOGOUT_WARNING =
  "You're offline. Signing out clears this device, but the server cannot end your session. It stays valid until it expires.";

const REACHABILITY_TIMEOUT_MS = 2_500;

/**
 * Probe, not the connectivity snapshot: a fresh /logout tab has no started hub, and
 * navigator.onLine stays true under the DevTools service-worker offline toggle. The probe has
 * no timeout of its own, and it answers `true` when aborted, so a timed-out probe is offline.
 */
async function probeReachableWithin(timeoutMs = REACHABILITY_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const reachable = await probeBrowserReachable(controller.signal);
    return reachable && !controller.signal.aborted;
  } finally {
    clearTimeout(timer);
  }
}

function queuedUploadsWarning(count: number): string {
  const files = count === 1 ? "1 file is" : `${count} files are`;
  return `${files} still waiting to upload. Signing out removes ${
    count === 1 ? "it" : "them"
  } from this device, so ${count === 1 ? "it is" : "they are"} not uploaded.`;
}

function unsyncedLogoutWarning(count: number | null): string {
  if (count === null) return "Unsynced changes on this device will be discarded.";
  if (count === 1) return "This device has 1 unsynced change. It will be discarded.";
  return `This device has ${count} unsynced changes. They will be discarded.`;
}

export function WeGotWorkspaceLogout({
  countUnsyncedChanges = countDiscardedUnsyncedChanges,
  countQueuedUploads = countDiscardedQueuedUploads,
  isGuestSession = wgwIsGuestSession,
  isOnline = probeReachableWithin,
  completeLogout = wgwCompleteLogoutNavigation,
}: WeGotWorkspaceLogoutProps = {}) {
  const navigate = useNavigate();
  const leaving = useRef(false);
  const [phase, setPhase] = useState<"pending" | "confirm" | "signing-out">("pending");
  const [unsyncedCount, setUnsyncedCount] = useState<number | null>(0);
  const [uploadCount, setUploadCount] = useState(0);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function signOut() {
      const navigation = await completeLogout();
      if (cancelled || navigation !== "member_login") return;
      await navigate({ to: "/login" });
    }

    void (async () => {
      if (!isGuestSession()) {
        let count: number | null = 0;
        try {
          count = await countUnsyncedChanges();
        } catch {
          count = null;
        }
        let uploads = 0;
        try {
          uploads = await countQueuedUploads();
        } catch {
          // The upload warning is a courtesy; the unsynced count still guards the wipe.
        }
        let isOffline = true;
        try {
          isOffline = !(await isOnline());
        } catch {
          // Unknown reachability: ask, as offline, rather than hang on "Signing out...".
        }
        if (cancelled) return;
        if (count === null || count > 0 || uploads > 0 || isOffline) {
          setUnsyncedCount(count);
          setUploadCount(uploads);
          setOffline(isOffline);
          setPhase("confirm");
          return;
        }
      }
      if (cancelled) return;
      setPhase("signing-out");
      await signOut();
    })();

    return () => {
      cancelled = true;
    };
  }, [
    completeLogout,
    countQueuedUploads,
    countUnsyncedChanges,
    isGuestSession,
    isOnline,
    navigate,
  ]);

  async function confirmSignOut() {
    if (leaving.current) return;
    leaving.current = true;
    setPhase("signing-out");
    const navigation = await completeLogout();
    if (navigation === "member_login") {
      await navigate({ to: "/login" });
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <p className="text-sm text-muted-foreground">
        {phase === "confirm" ? "Sign-out needs confirmation." : "Signing out..."}
      </p>
      <AlertDialog
        open={phase === "confirm"}
        onOpenChange={(open) => {
          if (open || leaving.current) return;
          if (window.history.length > 1) {
            window.history.back();
            return;
          }
          void navigate({ to: "/" });
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {uploadCount > 0
                ? "Uploads are not finished"
                : offline && unsyncedCount === 0
                  ? "Sign out while offline?"
                  : "Discard unsynced changes?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {[
                uploadCount > 0 ? queuedUploadsWarning(uploadCount) : null,
                offline ? OFFLINE_LOGOUT_WARNING : null,
                unsyncedCount === 0 ? null : unsyncedLogoutWarning(unsyncedCount),
              ]
                .filter(Boolean)
                .join(" ")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {uploadCount > 0 ? (
              <AlertDialogCancel
                onClick={(event) => {
                  event.preventDefault();
                  leaving.current = true;
                  void navigate({ to: "/drive", search: { view: "uploads" } });
                }}
              >
                Wait
              </AlertDialogCancel>
            ) : (
              <AlertDialogCancel>Cancel</AlertDialogCancel>
            )}
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={(event) => {
                  event.preventDefault();
                  void confirmSignOut();
                }}
              >
                {uploadCount > 0 ? "Sign out anyway" : "Sign out"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
