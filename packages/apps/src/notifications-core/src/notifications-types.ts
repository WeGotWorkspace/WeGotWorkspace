export type NotificationInboxItem = {
  id: string;
  title: string;
  body: string | null;
  navigate: string;
  tag: string | null;
  readAt: string | null;
  createdAt: string | null;
};

export type NotificationInboxList = {
  list: NotificationInboxItem[];
  unreadCount: number;
};
