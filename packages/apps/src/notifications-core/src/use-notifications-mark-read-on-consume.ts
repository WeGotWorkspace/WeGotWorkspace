import { useEffect, useRef } from "react";
import {
  useNotificationsInbox,
  type NotificationsInboxValue,
} from "@/notifications-core/src/notifications-inbox-context";
import {
  notificationMatchesDocsSharedPath,
  notificationMatchesNavigate,
} from "@/notifications-core/src/notification-consume-match";

export type UseNotificationsMarkReadOnConsumeArgs = {
  /** Meet (or other) inbox navigate for the focused surface. */
  navigate?: string | null;
  /** Docs/Drive API path for docs.shared rows (navigate alone is only /docs|/drive). */
  docsApiPath?: string | null;
  /**
   * False while the Meet transcript is scrolled up. Default true so Docs and
   * fully-caught-up Meet callers mark immediately.
   */
  caughtUp?: boolean;
};

function markIfVisible(
  markReadWhere: NotificationsInboxValue["markReadWhere"] | undefined,
  navigate: string | null | undefined,
  docsApiPath: string | null | undefined,
  caughtUp: boolean,
): void {
  if (!caughtUp || !markReadWhere) return;
  if (!navigate && !docsApiPath) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  void markReadWhere((item) => {
    if (navigate && notificationMatchesNavigate(item, navigate)) return true;
    if (docsApiPath && notificationMatchesDocsSharedPath(item, docsApiPath)) return true;
    return false;
  });
}

/**
 * When the user is viewing the destination a suite notification points at,
 * mark matching unread inbox rows read (channel open / doc open), same intent
 * as chat read markers — scoped, not “whole app”.
 */
export function useNotificationsMarkReadOnConsume({
  navigate = null,
  docsApiPath = null,
  caughtUp = true,
}: UseNotificationsMarkReadOnConsumeArgs): void {
  const inbox = useNotificationsInbox();
  const markReadWhere = inbox?.markReadWhere;
  const items = inbox?.items;
  const markRef = useRef(markReadWhere);
  markRef.current = markReadWhere;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const docsRef = useRef(docsApiPath);
  docsRef.current = docsApiPath;
  const caughtUpRef = useRef(caughtUp);
  caughtUpRef.current = caughtUp;

  useEffect(() => {
    markIfVisible(markRef.current, navigate, docsApiPath, caughtUp);
  }, [markReadWhere, navigate, docsApiPath, caughtUp, items]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      markIfVisible(markRef.current, navigateRef.current, docsRef.current, caughtUpRef.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
}
