import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsInboxValueProvider } from "@/notifications-core/src/notifications-inbox-context";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";
import { useNotificationsMarkReadOnConsume } from "@/notifications-core/src/use-notifications-mark-read-on-consume";

const dmItem: NotificationInboxItem = {
  id: "n1",
  domain: "chat",
  action: "message_posted",
  title: "Alice sent you a direct message",
  body: "hi",
  navigate: "/meet/dms/alice",
  tag: "chat.message:1",
  readAt: null,
  createdAt: null,
};

const shareItem: NotificationInboxItem = {
  id: "n2",
  domain: "docs",
  action: "shared",
  data: { path: "/users/bob/notes.md" },
  title: "Bob shared notes.md with you",
  body: "/users/bob/notes.md",
  navigate: "/docs",
  tag: "docs.shared:1",
  readAt: null,
  createdAt: null,
};

afterEach(() => {
  cleanup();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

describe("useNotificationsMarkReadOnConsume", () => {
  it("marks Meet navigate matches when the conversation is focused", () => {
    const markReadWhere = vi.fn(async (match: (item: NotificationInboxItem) => boolean) => {
      expect(match(dmItem)).toBe(true);
      expect(match(shareItem)).toBe(false);
    });

    function Harness({ navigate }: { navigate: string | null }) {
      useNotificationsMarkReadOnConsume({ navigate, caughtUp: true });
      return null;
    }

    const { rerender } = render(
      <NotificationsInboxValueProvider
        value={{
          items: [dmItem, shareItem],
          unreadCount: 2,
          onOpenItem: () => undefined,
          onMarkAllRead: () => undefined,
          markReadWhere,
          onEnablePush: () => undefined,
          pushEnabled: true,
        }}
      >
        <Harness navigate={null} />
      </NotificationsInboxValueProvider>,
    );
    expect(markReadWhere).not.toHaveBeenCalled();

    rerender(
      <NotificationsInboxValueProvider
        value={{
          items: [dmItem, shareItem],
          unreadCount: 2,
          onOpenItem: () => undefined,
          onMarkAllRead: () => undefined,
          markReadWhere,
          onEnablePush: () => undefined,
          pushEnabled: true,
        }}
      >
        <Harness navigate="/meet/dms/alice" />
      </NotificationsInboxValueProvider>,
    );
    expect(markReadWhere).toHaveBeenCalledTimes(1);
  });

  it("marks docs.shared by open file path", () => {
    const markReadWhere = vi.fn(async (match: (item: NotificationInboxItem) => boolean) => {
      expect(match(shareItem)).toBe(true);
      expect(match(dmItem)).toBe(false);
    });

    function Harness() {
      useNotificationsMarkReadOnConsume({ docsApiPath: "/users/bob/notes.md" });
      return null;
    }

    render(
      <NotificationsInboxValueProvider
        value={{
          items: [dmItem, shareItem],
          unreadCount: 2,
          onOpenItem: () => undefined,
          onMarkAllRead: () => undefined,
          markReadWhere,
          onEnablePush: () => undefined,
          pushEnabled: true,
        }}
      >
        <Harness />
      </NotificationsInboxValueProvider>,
    );
    expect(markReadWhere).toHaveBeenCalledTimes(1);
  });

  it("does not mark while scrolled up (caughtUp false)", () => {
    const markReadWhere = vi.fn(async () => undefined);

    function Harness() {
      useNotificationsMarkReadOnConsume({
        navigate: "/meet/dms/alice",
        caughtUp: false,
      });
      return null;
    }

    render(
      <NotificationsInboxValueProvider
        value={{
          items: [dmItem],
          unreadCount: 1,
          onOpenItem: () => undefined,
          onMarkAllRead: () => undefined,
          markReadWhere,
          onEnablePush: () => undefined,
          pushEnabled: true,
        }}
      >
        <Harness />
      </NotificationsInboxValueProvider>,
    );
    expect(markReadWhere).not.toHaveBeenCalled();
  });
});
