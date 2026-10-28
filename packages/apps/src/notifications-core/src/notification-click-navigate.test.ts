import { describe, expect, it } from "vitest";
import {
  assignNotificationNavigate,
  isSafariDeclarativeWebPushUserAgent,
  notificationClickTarget,
  notificationNavigateFromMessage,
  pickNotificationClient,
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

describe("notificationClickTarget", () => {
  const origin = "https://wegot.example";

  it("opens the deep link when it lies inside the receiving app's scope", () => {
    expect(notificationClickTarget("/docs?file=a.md", "/docs", origin)).toEqual({
      href: "https://wegot.example/docs?file=a.md",
      path: "/docs?file=a.md",
      scope: "/docs",
    });
    expect(notificationClickTarget("/drive", "/", origin)).toMatchObject({
      path: "/drive",
      scope: "/",
    });
  });

  it("opens the app's own start when the link points outside its scope", () => {
    expect(notificationClickTarget("/drive", "/docs", origin)).toEqual({
      href: "https://wegot.example/docs",
      path: "/docs",
      scope: "/docs",
    });
  });

  it("treats a missing or foreign scope as the suite scope", () => {
    expect(notificationClickTarget("/drive", undefined, origin).scope).toBe("/");
    expect(notificationClickTarget("/drive", "//evil.example", origin).scope).toBe("/");
    expect(notificationClickTarget("/drive", "/evil", origin)).toMatchObject({
      path: "/drive",
      scope: "/",
    });
  });
});

describe("pickNotificationClient", () => {
  const client = (url: string) => ({ url });

  it("focuses a window that is already inside the receiving app", () => {
    const calendar = client("https://wegot.example/calendar");
    const docs = client("https://wegot.example/docs/report.md");
    expect(pickNotificationClient([calendar, docs], "/docs")).toBe(docs);
  });

  it("opens a new window instead of taking over another app's window", () => {
    expect(pickNotificationClient([client("https://wegot.example/calendar")], "/docs")).toBeNull();
    expect(pickNotificationClient([], "/docs")).toBeNull();
  });

  it("keeps using the first window for the suite scope", () => {
    const calendar = client("https://wegot.example/calendar");
    expect(pickNotificationClient([calendar, client("https://wegot.example/docs")], "/")).toBe(
      calendar,
    );
  });
});
