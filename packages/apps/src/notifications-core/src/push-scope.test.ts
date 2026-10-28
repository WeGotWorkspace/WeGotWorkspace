import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  currentPushScope,
  isStandaloneDisplay,
  isWithinPushScope,
  mergePushScopes,
  pushScopeForLaunch,
  readPushScopes,
  rememberLaunchPath,
  rememberPushScope,
  resetPushScopeLaunchForTests,
} from "./push-scope";

describe("pushScopeForLaunch", () => {
  it("uses the suite scope in a browser tab, whatever the path", () => {
    expect(pushScopeForLaunch({ standalone: false, launchPath: "/docs" })).toBe("/");
    expect(pushScopeForLaunch({ standalone: false, launchPath: "/meet/channels/general" })).toBe(
      "/",
    );
  });

  it("uses the manifest id of the installed app it was launched as", () => {
    expect(pushScopeForLaunch({ standalone: true, launchPath: "/docs" })).toBe("/docs");
    expect(pushScopeForLaunch({ standalone: true, launchPath: "/docs/report.md" })).toBe("/docs");
    expect(pushScopeForLaunch({ standalone: true, launchPath: "/notes/all" })).toBe("/notes");
    expect(pushScopeForLaunch({ standalone: true, launchPath: "/contacts/all" })).toBe("/contacts");
    expect(pushScopeForLaunch({ standalone: true, launchPath: "/meet/meetings/standup" })).toBe(
      "/meet",
    );
  });

  it("uses the suite scope for the suite PWA and for paths outside any app", () => {
    expect(pushScopeForLaunch({ standalone: true, launchPath: "/" })).toBe("/");
    expect(pushScopeForLaunch({ standalone: true, launchPath: "/login" })).toBe("/");
    expect(pushScopeForLaunch({ standalone: true, launchPath: "/docsx" })).toBe("/");
  });
});

describe("isStandaloneDisplay", () => {
  const media = (matches: boolean) => () => ({ matches }) as MediaQueryList;

  it("reads display-mode standalone", () => {
    expect(isStandaloneDisplay({ matchMedia: media(true), navigator: {} })).toBe(true);
    expect(isStandaloneDisplay({ matchMedia: media(false), navigator: {} })).toBe(false);
  });

  it("reads the iOS Home Screen flag", () => {
    expect(isStandaloneDisplay({ matchMedia: media(false), navigator: { standalone: true } })).toBe(
      true,
    );
  });

  it("is false without matchMedia", () => {
    expect(isStandaloneDisplay({ navigator: {} })).toBe(false);
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

describe("rememberPushScope / readPushScopes", () => {
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
});

describe("currentPushScope", () => {
  const standaloneAt = (pathname: string) => ({
    matchMedia: () => ({ matches: true }) as MediaQueryList,
    navigator: {},
    location: { pathname },
  });

  it("uses the path the app was launched at, not where it navigated since", () => {
    resetPushScopeLaunchForTests();
    rememberLaunchPath("/docs");
    // A later sign-in redirect or in-app link must not change the installed app.
    rememberLaunchPath("/login");
    expect(currentPushScope(standaloneAt("/calendar"))).toBe("/docs");
    resetPushScopeLaunchForTests();
  });

  it("falls back to the current path when no launch path was recorded", () => {
    resetPushScopeLaunchForTests();
    expect(currentPushScope(standaloneAt("/tasks/lists/inbox"))).toBe("/tasks");
  });

  it("is the suite scope in a browser tab", () => {
    resetPushScopeLaunchForTests();
    rememberLaunchPath("/docs");
    expect(
      currentPushScope({
        matchMedia: () => ({ matches: false }) as MediaQueryList,
        navigator: {},
        location: { pathname: "/docs" },
      }),
    ).toBe("/");
    resetPushScopeLaunchForTests();
  });
});
