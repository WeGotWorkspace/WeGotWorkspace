import { describe, expect, it } from "vitest";
import {
  notificationInScope,
  notificationScopeAppAt,
} from "@/notifications-core/src/notification-scope";

const chat = { domain: "chat", navigate: "/meet/dms/member" };
const note = { domain: "notes", navigate: "/notes" };
const driveShare = { domain: "docs", navigate: "/drive?path=%2Fusers%2Fmember%2Foffer.pdf" };

describe("notificationScopeAppAt", () => {
  it("names the product app of a route, with or without a query", () => {
    expect(notificationScopeAppAt("/notes/all/abc")).toBe("notes");
    expect(notificationScopeAppAt("/docs?id=fn-1")).toBe("docs");
    expect(notificationScopeAppAt("/calendar")).toBe("calendar");
  });

  it("has no app on home, in Settings and in Admin, where the scope does not apply", () => {
    expect(notificationScopeAppAt("/")).toBeUndefined();
    expect(notificationScopeAppAt("/settings/profile")).toBeUndefined();
    expect(notificationScopeAppAt("/admin")).toBeUndefined();
    expect(notificationScopeAppAt("/notesy")).toBeUndefined();
  });
});

describe("notificationInScope", () => {
  it("lets every row through for all apps", () => {
    expect(notificationInScope(chat, "/notes/all", "all")).toBe(true);
    expect(notificationInScope(note, "/notes/all", "all")).toBe(true);
  });

  it("keeps only the current app's rows for the app scope", () => {
    expect(notificationInScope(note, "/notes/all", "app")).toBe(true);
    expect(notificationInScope(chat, "/notes/all", "app")).toBe(false);
    // Chat lives in Meet; a Drive share is Drive's, not Docs'.
    expect(notificationInScope(chat, "/meet/channels/x", "app")).toBe(true);
    expect(notificationInScope(driveShare, "/drive", "app")).toBe(true);
    expect(notificationInScope(driveShare, "/docs", "app")).toBe(false);
  });

  it("lets every row through where the scope does not apply", () => {
    expect(notificationInScope(chat, "/settings", "app")).toBe(true);
    expect(notificationInScope(chat, "/", "app")).toBe(true);
  });
});
