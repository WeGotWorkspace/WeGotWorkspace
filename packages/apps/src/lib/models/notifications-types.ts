/** Structured facts stored on inbox rows — format at the tray / push edge. */
export type NotificationFacts = Record<string, unknown>;

export type NotificationInboxItem = {
  id: string;
  domain: string;
  action: string;
  /** Structured facts; when present, {@link formatNotificationCopy} wins over title/body. */
  data?: NotificationFacts | null;
  title: string;
  body: string | null;
  navigate: string;
  tag: string | null;
  /**
   * The Project of the row's subject; null or absent when it is in none (a DM, a personal
   * invite) and on rows from before Projects. The Project filter narrows by it.
   */
  projectId?: string | null;
  readAt: string | null;
  createdAt: string | null;
};

export type NotificationInboxList = {
  list: NotificationInboxItem[];
  unreadCount: number;
};

export type NotificationCopy = {
  /** Full plain-text title (OS toast / a11y / legacy). */
  title: string;
  /**
   * When set, the tray bolds only `actor` and renders `titleRest` at regular weight.
   * Omitted for legacy rows and titles without a leading actor (reminders).
   */
  titleActor?: string;
  titleRest?: string;
  body: string | null;
};
