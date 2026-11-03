import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  currentPushScope,
  forgetPushScopes,
  hasOwnPushSubscription,
  isWithinPushScope,
  mergePushScopes,
  normalizePushPath,
  pushScopeForLaunch,
  pushScopesToPost,
  readPushScopes,
  rememberLaunchPath,
  rememberPushScope,
  resetPushScopeLaunchForTests,
} from "./push-scope";

describe("pushScopeForLaunch", () => {
  it("uses the suite scope where installed apps share one subscription", () => {
    // Desktop and Android: one subscription per browser profile, whatever opened it.
    expect(pushScopeForLaunch({ ownSubscription: false, launchPath: "/docs" })).toBe("/");
    expect(
      pushScopeForLaunch({ ownSubscription: false, launchPath: "/meet/channels/general" }),
    ).toBe("/");
    expect(pushScopeForLaunch({ ownSubscription: false, launchPath: "/logout" })).toBe("/");
  });

  it("uses the manifest id of the installed app it was launched as", () => {
    expect(pushScopeForLaunch({ ownSubscription: true, launchPath: "/docs" })).toBe("/docs");
    expect(pushScopeForLaunch({ ownSubscription: true, launchPath: "/docs/report.md" })).toBe(
      "/docs",
    );
    expect(pushScopeForLaunch({ ownSubscription: true, launchPath: "/docs?file=a.md" })).toBe(
      "/docs",
    );
    expect(pushScopeForLaunch({ ownSubscription: true, launchPath: "/notes/all" })).toBe("/notes");
    expect(pushScopeForLaunch({ ownSubscription: true, launchPath: "/contacts/all" })).toBe(
      "/contacts",
    );
    expect(
      pushScopeForLaunch({ ownSubscription: true, launchPath: "/meet/meetings/standup" }),
    ).toBe("/meet");
  });

  it("uses the suite scope for the suite app", () => {
    expect(pushScopeForLaunch({ ownSubscription: true, launchPath: "/" })).toBe("/");
    expect(pushScopeForLaunch({ ownSubscription: true, launchPath: "/?from=home" })).toBe("/");
  });

  it("uses the app a sign-in page returns to", () => {
    // Session expiry hard-navigates to /login?return=…, a new document.
    expect(pushScopeForLaunch({ ownSubscription: true, launchPath: "/login?return=%2Fdocs" })).toBe(
      "/docs",
    );
    expect(
      pushScopeForLaunch({
        ownSubscription: true,
        launchPath: "/login?return=%2Fcalendar%2Fweek%3Fdate%3D2026-10-29",
      }),
    ).toBe("/calendar");
    expect(
      pushScopeForLaunch({
        ownSubscription: true,
        launchPath: `/login?return=${encodeURIComponent("/login?return=/tasks")}`,
      }),
    ).toBe("/tasks");
  });

  it("does not know the app after a hard navigation outside every app", () => {
    // Logout loads /logout, then /login; the endpoint row is gone by then.
    expect(pushScopeForLaunch({ ownSubscription: true, launchPath: "/logout" })).toBeNull();
    expect(pushScopeForLaunch({ ownSubscription: true, launchPath: "/login" })).toBeNull();
    expect(
      pushScopeForLaunch({ ownSubscription: true, launchPath: "/login?return=%2F" }),
    ).toBeNull();
    expect(
      pushScopeForLaunch({ ownSubscription: true, launchPath: "/login?return=%2Fshare%2Fx" }),
    ).toBeNull();
    expect(
      pushScopeForLaunch({
        ownSubscription: true,
        launchPath: "/login?return=https%3A%2F%2Fx.test%2Fdocs",
      }),
    ).toBeNull();
    expect(pushScopeForLaunch({ ownSubscription: true, launchPath: "/share/abc" })).toBeNull();
    expect(pushScopeForLaunch({ ownSubscription: true, launchPath: "/docsx" })).toBeNull();
  });

  it("reads the app from the normalised path", () => {
    expect(pushScopeForLaunch({ ownSubscription: true, launchPath: "/docs/../calendar" })).toBe(
      "/calendar",
    );
  });
});

describe("hasOwnPushSubscription", () => {
  it("is true for an iOS Home Screen app", () => {
    expect(hasOwnPushSubscription({ navigator: { standalone: true } })).toBe(true);
  });

  it("is false in a browser tab and in desktop or Android installed apps", () => {
    expect(hasOwnPushSubscription({ navigator: { standalone: false } })).toBe(false);
    expect(hasOwnPushSubscription({ navigator: {} })).toBe(false);
  });
});

describe("normalizePushPath", () => {
  it("resolves dot segments, also when percent-encoded", () => {
    expect(normalizePushPath("/docs/../calendar")).toBe("/calendar");
    expect(normalizePushPath("/docs/%2e%2e/calendar?x=1#y")).toBe("/calendar?x=1#y");
    expect(normalizePushPath("/docs/./report.md")).toBe("/docs/report.md");
    expect(normalizePushPath("/docs?file=../calendar")).toBe("/docs?file=../calendar");
  });
});

describe("isWithinPushScope", () => {
  it("matches the scope itself and paths below it", () => {
    expect(isWithinPushScope("/docs", "/docs")).toBe(true);
    expect(isWithinPushScope("/docs/report.md", "/docs")).toBe(true);
    expect(isWithinPushScope("/docs?file=a.md", "/docs")).toBe(true);
    expect(isWithinPushScope("/docs#thread", "/docs")).toBe(true);
    expect(isWithinPushScope("/docsx", "/docs")).toBe(false);
    expect(isWithinPushScope("/drive", "/docs")).toBe(false);
  });

  it("does not let dot segments leave the scope", () => {
    expect(isWithinPushScope("/docs/../calendar", "/docs")).toBe(false);
    expect(isWithinPushScope("/docs/%2E%2E/calendar", "/docs")).toBe(false);
    expect(isWithinPushScope("/docs/a/../b", "/docs")).toBe(true);
  });

  it("puts every path inside the suite scope", () => {
    expect(isWithinPushScope("/drive", "/")).toBe(true);
    expect(isWithinPushScope("/", "/")).toBe(true);
  });
});

describe("mergePushScopes", () => {
  it("keeps every app scope, and the suite scope replaces them all", () => {
    expect(mergePushScopes([], "/docs")).toEqual(["/docs"]);
    expect(mergePushScopes(["/docs"], "/calendar")).toEqual(["/calendar", "/docs"]);
    expect(mergePushScopes(["/docs"], "/docs")).toEqual(["/docs"]);
    expect(mergePushScopes(["/calendar", "/docs"], "/")).toEqual(["/"]);
    expect(mergePushScopes(["/"], "/docs")).toEqual(["/"]);
  });
});

describe("pushScopesToPost", () => {
  it("posts the remembered scopes and the current one", () => {
    expect(pushScopesToPost(["/calendar", "/docs"], "/docs")).toEqual(["/calendar", "/docs"]);
    expect(pushScopesToPost(["/docs"], "/tasks")).toEqual(["/docs", "/tasks"]);
    expect(pushScopesToPost(["/docs"], "/")).toEqual(["/"]);
  });

  it("posts the remembered scopes when the current app is unknown", () => {
    expect(pushScopesToPost(["/docs"], null)).toEqual(["/docs"]);
  });

  it("posts once without a scope when nothing is known", () => {
    expect(pushScopesToPost([], null)).toEqual([null]);
  });
});

describe("rememberPushScope / readPushScopes / forgetPushScopes", () => {
  it("is empty until a page remembers a scope", async () => {
    await expect(readPushScopes(new IDBFactory())).resolves.toEqual([]);
  });

  it("merges the scopes pages post, for the service worker to post again", async () => {
    const idb = new IDBFactory();
    await rememberPushScope("/docs", idb);
    await expect(readPushScopes(idb)).resolves.toEqual(["/docs"]);
    await rememberPushScope("/calendar", idb);
    await expect(readPushScopes(idb)).resolves.toEqual(["/calendar", "/docs"]);
    await rememberPushScope("/", idb);
    await expect(readPushScopes(idb)).resolves.toEqual(["/"]);
  });

  it("drops stored values that are not manifest ids", async () => {
    const idb = new IDBFactory();
    await rememberPushScope("/evil", idb);
    await expect(readPushScopes(idb)).resolves.toEqual([]);
  });

  it("forgets every remembered scope", async () => {
    const idb = new IDBFactory();
    await rememberPushScope("/docs", idb);
    await forgetPushScopes(idb);
    await expect(readPushScopes(idb)).resolves.toEqual([]);
  });
});

describe("currentPushScope", () => {
  const iosAppAt = (pathname: string, search = "") => ({
    navigator: { standalone: true },
    location: { pathname, search },
  });

  it("uses the path the app was launched at, not where it navigated since", () => {
    resetPushScopeLaunchForTests();
    rememberLaunchPath("/docs");
    // A later sign-in redirect or in-app link must not change the installed app.
    rememberLaunchPath("/login");
    expect(currentPushScope(iosAppAt("/calendar"))).toBe("/docs");
    resetPushScopeLaunchForTests();
  });

  it("falls back to the current path when no launch path was recorded", () => {
    resetPushScopeLaunchForTests();
    expect(currentPushScope(iosAppAt("/tasks/lists/inbox"))).toBe("/tasks");
    expect(currentPushScope(iosAppAt("/login", "?return=%2Fnotes"))).toBe("/notes");
  });

  it("is unknown when a single-app iPhone app relaunched at /logout", () => {
    resetPushScopeLaunchForTests();
    rememberLaunchPath("/logout");
    expect(currentPushScope(iosAppAt("/docs"))).toBeNull();
    resetPushScopeLaunchForTests();
  });

  it("is the suite scope on desktop and Android, even in an installed app window", () => {
    resetPushScopeLaunchForTests();
    rememberLaunchPath("/docs");
    const desktopApp = {
      matchMedia: () => ({ matches: true }) as MediaQueryList,
      navigator: {},
      location: { pathname: "/docs", search: "" },
    };
    expect(currentPushScope(desktopApp)).toBe("/");
    resetPushScopeLaunchForTests();
  });
});

describe("rememberLaunchPath across documents in one window", () => {
  const iosAppAt = (pathname: string, search = "") => ({
    navigator: { standalone: true },
    location: { pathname, search },
  });

  /** A window's sessionStorage; it survives reloads and hard navigations. */
  function windowStorage(): Pick<Storage, "getItem" | "setItem"> {
    const values = new Map<string, string>();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    };
  }

  /** Each call is a new document (hard navigation or reload) in that window. */
  function loadDocument(storage: Pick<Storage, "getItem" | "setItem">, pathAndSearch: string) {
    resetPushScopeLaunchForTests();
    rememberLaunchPath(pathAndSearch, storage);
  }

  it("keeps the app when an inbox click hard-navigates to another app", () => {
    const docsWindow = windowStorage();
    loadDocument(docsWindow, "/docs");
    // goToNotificationNavigate → window.location.assign("/calendar")
    loadDocument(docsWindow, "/calendar");
    expect(currentPushScope(iosAppAt("/calendar"))).toBe("/docs");
    resetPushScopeLaunchForTests();
  });

  it("keeps the app when a service worker update reloads at /", () => {
    const docsWindow = windowStorage();
    loadDocument(docsWindow, "/docs?file=report.md");
    loadDocument(docsWindow, "/");
    expect(currentPushScope(iosAppAt("/"))).toBe("/docs");
    resetPushScopeLaunchForTests();
  });

  it("keeps the app through logout and the next sign-in in the same window", () => {
    // The window is still the Docs app; only the account changes.
    const docsWindow = windowStorage();
    loadDocument(docsWindow, "/docs");
    loadDocument(docsWindow, "/logout");
    loadDocument(docsWindow, "/login");
    expect(currentPushScope(iosAppAt("/login"))).toBe("/docs");
    resetPushScopeLaunchForTests();
  });

  it("records its own path in a fresh window", () => {
    const docsWindow = windowStorage();
    loadDocument(docsWindow, "/docs");
    loadDocument(windowStorage(), "/tasks");
    expect(currentPushScope(iosAppAt("/tasks"))).toBe("/tasks");
    resetPushScopeLaunchForTests();
  });

  it("uses this document's path when sessionStorage cannot be used", () => {
    const blocked = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    loadDocument(blocked, "/notes");
    expect(currentPushScope(iosAppAt("/notes"))).toBe("/notes");
    loadDocument(blocked, "/calendar");
    expect(currentPushScope(iosAppAt("/calendar"))).toBe("/calendar");
    resetPushScopeLaunchForTests();
  });

  it("ignores an unusable stored value", () => {
    const docsWindow = windowStorage();
    docsWindow.setItem("wgw-push-launch-path", "https://evil.example/docs");
    loadDocument(docsWindow, "/calendar");
    expect(currentPushScope(iosAppAt("/calendar"))).toBe("/calendar");
    resetPushScopeLaunchForTests();
  });
});
