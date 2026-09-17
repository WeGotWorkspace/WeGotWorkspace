import { describe, expect, it } from "vitest";
import {
  normalizeNotificationNavigate,
  notificationMatchesDocsSharedPath,
  notificationMatchesNavigate,
} from "@/notifications-core/src/notification-consume-match";

describe("normalizeNotificationNavigate", () => {
  it("strips trailing slashes and lowercases DM peers", () => {
    expect(normalizeNotificationNavigate("/meet/dms/Alice/")).toBe("/meet/dms/alice");
    expect(normalizeNotificationNavigate("/meet/dms/%41lice")).toBe("/meet/dms/alice");
  });

  it("keeps channel and meeting public ids as-is aside from trailing slash", () => {
    expect(normalizeNotificationNavigate("/meet/channels/01H455/")).toBe("/meet/channels/01H455");
  });
});

describe("notificationMatchesNavigate", () => {
  it("matches the open Meet conversation only", () => {
    expect(notificationMatchesNavigate({ navigate: "/meet/dms/alice" }, "/meet/dms/Alice")).toBe(
      true,
    );
    expect(
      notificationMatchesNavigate({ navigate: "/meet/channels/general" }, "/meet/channels/other"),
    ).toBe(false);
    expect(notificationMatchesNavigate({ navigate: "/meet/dms/alice" }, "/meet")).toBe(false);
    expect(notificationMatchesNavigate({ navigate: "/meet/dms/alice" }, "/")).toBe(false);
  });
});

describe("notificationMatchesDocsSharedPath", () => {
  it("matches docs.shared by data.path, not by coarse /docs navigate", () => {
    expect(
      notificationMatchesDocsSharedPath(
        {
          domain: "docs",
          action: "shared",
          data: { path: "/users/bob/notes.md" },
        },
        "/users/bob/notes.md",
      ),
    ).toBe(true);
    expect(
      notificationMatchesDocsSharedPath(
        {
          domain: "docs",
          action: "shared",
          data: { path: "/users/bob/notes.md" },
        },
        "users/bob/notes.md",
      ),
    ).toBe(true);
    expect(
      notificationMatchesDocsSharedPath(
        {
          domain: "docs",
          action: "shared",
          data: { path: "/users/bob/notes.md" },
        },
        "/users/bob/other.md",
      ),
    ).toBe(false);
    expect(
      notificationMatchesDocsSharedPath(
        { domain: "chat", action: "message_posted", data: { path: "/users/bob/notes.md" } },
        "/users/bob/notes.md",
      ),
    ).toBe(false);
  });
});
