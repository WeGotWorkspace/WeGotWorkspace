import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";

export type NotificationsInboxValue = {
  items: readonly NotificationInboxItem[];
  unreadCount: number;
  onOpenItem: (item: NotificationInboxItem) => void;
  onMarkAllRead: () => void;
  /**
   * Mark unread rows that match the predicate (e.g. open Meet channel / Docs file).
   * Best-effort; updates the tray immediately then acks the server.
   */
  markReadWhere: (match: (item: NotificationInboxItem) => boolean) => Promise<void>;
  onEnablePush: () => void;
  pushEnabled: boolean;
  /** Device-local mute for the inbox chime (localStorage). Does not affect badge pulse. */
  soundMuted: boolean;
  onToggleSoundMute: () => void;
  /**
   * Increments when newly first-seen unread ids arrive after the initial seed.
   * Badge consumers restart a one-shot pulse when this changes.
   */
  unreadArrivalNonce: number;
};

const NotificationsInboxContext = createContext<NotificationsInboxValue | null>(null);

export function useNotificationsInbox(): NotificationsInboxValue | null {
  return useContext(NotificationsInboxContext);
}

/** Bare injector for Storybook / tests: skip inbox polling. */
export function NotificationsInboxValueProvider({
  value,
  children,
}: {
  value: NotificationsInboxValue | null;
  children: ReactNode;
}): ReactElement {
  return (
    <NotificationsInboxContext.Provider value={value}>
      {children}
    </NotificationsInboxContext.Provider>
  );
}
