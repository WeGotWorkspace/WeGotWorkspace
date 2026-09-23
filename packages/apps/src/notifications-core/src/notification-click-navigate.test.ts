import { describe, expect, it } from "vitest";
import {
  assignNotificationNavigate,
  isSafariDeclarativeWebPushUserAgent,
  notificationNavigateFromMessage,
  resolveNotificationNavigateHref,
  sanitizeNotificationNavigate,
  WEB_PUSH_DECLARATIVE_VERSION,
  WGW_NOTIFICATION_NAVIGATE_MESSAGE,
} from "./notification-click-navigate";

describe("sanitizeNotificationNavigate", () => {
  it("keeps relative suite paths and extracts paths from absolute URLs", () => {
    expect(sanitizeNotificationNavigate("/meet/channels/general")).toBe("/meet/channels/general");
    expect(sanitizeNotificationNavigate("https://wegot.example/meet/dms/alice")).toBe(
      "/meet/dms/alice",
    );
    expect(sanitizeNotificationNavigate("https://evil.example/phish")).toBe("/phish");
    expect(sanitizeNotificationNavigate("https://evil.example")).toBe("/");
    expect(sanitizeNotificationNavigate("//evil.example/meet")).toBe("/");
  });
});

describe("resolveNotificationNavigateHref", () => {
  it("resolves a path against the SW origin", () => {
    expect(resolveNotificationNavigateHref("/meet/dms/alice", "https://wegot.example")).toBe(
      "https://wegot.example/meet/dms/alice",
    );
  });
});

describe("notificationNavigateFromMessage", () => {
  it("reads SW postMessage payloads", () => {
    expect(
      notificationNavigateFromMessage({
        type: WGW_NOTIFICATION_NAVIGATE_MESSAGE,
        navigate: "/meet/channels/general",
      }),
    ).toBe("/meet/channels/general");
    expect(notificationNavigateFromMessage({ type: "other" })).toBeNull();
  });
});

describe("assignNotificationNavigate", () => {
  it("assigns the deep link when signed in", () => {
    const assign = (href: string) => {
      expect(href).toBe("/meet/dms/alice");
    };
    assignNotificationNavigate("/meet/dms/alice", true, assign);
  });

  it("wraps private DM paths in login return when the session expired", () => {
    const assign = (href: string) => {
      expect(href).toBe("/login?return=".concat(encodeURIComponent("/meet/dms/alice")));
    };
    assignNotificationNavigate("/meet/dms/alice", false, assign);
  });

  it("does not force login for public channel paths", () => {
    const assign = (href: string) => {
      expect(href).toBe("/meet/channels/general");
    };
    assignNotificationNavigate("/meet/channels/general", false, assign);
  });
});

describe("isSafariDeclarativeWebPushUserAgent", () => {
  it("detects macOS Safari and not Chrome", () => {
    expect(
      isSafariDeclarativeWebPushUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      ),
    ).toBe(true);
    expect(
      isSafariDeclarativeWebPushUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
    expect(WEB_PUSH_DECLARATIVE_VERSION).toBe(8030);
  });
});
