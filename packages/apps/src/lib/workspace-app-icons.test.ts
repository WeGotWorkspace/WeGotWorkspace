import { describe, expect, it } from "vitest";
import {
  WORKSPACE_APP_ACCENT,
  WORKSPACE_APP_IDS,
  workspaceAppIconAppleTouchSrc,
  workspaceAppIconManifestSrc,
  workspaceAppIconUiSrc,
  workspaceAppLabel,
  workspaceAppLabelFromPath,
} from "@/lib/workspace-app-icons";
import {
  WORKSPACE_APP_ICON_INLINE,
  WORKSPACE_HOME_ICON_INLINE,
} from "@/lib/workspace-app-icon-svgs";

describe("workspaceAppIconUiSrc", () => {
  it("points at canonical vector artwork under /app-icons/", () => {
    expect(workspaceAppIconUiSrc("mail")).toBe("/app-icons/mail.svg");
  });
});

describe("WORKSPACE_APP_ICON_INLINE", () => {
  it("bundles inline SVG markup for every workspace app", () => {
    for (const appId of WORKSPACE_APP_IDS) {
      expect(WORKSPACE_APP_ICON_INLINE[appId]).toMatch(/^<svg[\s>]/);
      expect(WORKSPACE_APP_ICON_INLINE[appId]).toContain("--wai-bg");
    }
  });

  it("maps each app to distinct artwork (no cross-app SVG reuse)", () => {
    const markups = WORKSPACE_APP_IDS.map((appId) => WORKSPACE_APP_ICON_INLINE[appId]);

    for (let i = 0; i < markups.length; i++) {
      for (let j = i + 1; j < markups.length; j++) {
        expect(markups[i]).not.toBe(markups[j]);
      }
    }
  });

  it("keeps tile backgrounds square (no baked-in corner radius)", () => {
    for (const appId of WORKSPACE_APP_IDS) {
      const markup = WORKSPACE_APP_ICON_INLINE[appId];
      // Background layer is the first rect/path with --wai-bg; it must not use tile rx.
      const bgLayer = markup.match(
        /<(?:rect|path)[^>]*fill="var\(--wai-bg[^"]*"[^>]*\/?>|<(?:rect|path)[^>]*rx="45"[^>]*fill="var\(--wai-bg/,
      )?.[0];
      expect(bgLayer, `${appId} should have a --wai-bg layer`).toBeTruthy();
      expect(bgLayer).not.toMatch(/\brx="/);
      expect(markup).not.toMatch(/<(?:rect|path)[^>]*\brx="45"/);
    }
  });

  it("keeps notes as the orange notepad, not the contacts person", () => {
    const notes = WORKSPACE_APP_ICON_INLINE.notes;
    const contacts = WORKSPACE_APP_ICON_INLINE.contacts;

    expect(notes).toContain('d="M0 45C0 20.147');
    expect(notes).toContain("#ffc800");
    expect(notes).toContain("#ffffff");
    expect(notes).not.toContain('d="M45 201c0-24.853');
    expect(contacts).toContain('d="M45 201c0-24.853');
    expect(contacts).toContain('cx="135"');
    expect(contacts).toContain("#a3c4e8");
    expect(contacts).toContain("#ffffff");
    expect(contacts).not.toContain('d="M0 45C0 20.147');
    expect(contacts).not.toContain('d="M256 280C284.719');
  });
});

describe("WORKSPACE_HOME_ICON_INLINE", () => {
  it("is the solid #003311 suite mark with viewBox 0 0 60 60", () => {
    expect(WORKSPACE_HOME_ICON_INLINE).toMatch(/^<svg[\s>]/);
    expect(WORKSPACE_HOME_ICON_INLINE).toContain('viewBox="0 0 60 60"');
    expect(WORKSPACE_HOME_ICON_INLINE).toContain('fill="#003311"');
    expect(WORKSPACE_HOME_ICON_INLINE).toContain(
      'd="M45 0c8.286 0 15 6.717 15 15.001s-6.715 15-15 15H45c8.284 0 15 6.715 15 15 0 8.283-6.716 14.999-15 14.999s-15-6.716-15-15c0 8.284-6.715 15-15 15C6.717 60 0 53.284 0 45s6.716-15 15-15C6.715 30 0 23.283 0 15S6.714 0 15 0s15 6.716 15 15c0-8.284 6.715-15 15-15"',
    );
    expect(WORKSPACE_HOME_ICON_INLINE).not.toContain("--wai-bg");
    expect(WORKSPACE_HOME_ICON_INLINE).not.toContain("250.643");
    expect(WORKSPACE_HOME_ICON_INLINE).not.toMatch(/#1[Bb]1[Dd]3[Aa]/);
    expect(WORKSPACE_HOME_ICON_INLINE).not.toMatch(/#F59F00|#0CA678|#4C6EF5/i);
  });
});

describe("workspaceAppIconUiSrc mapping", () => {
  it("resolves one canonical SVG per workspace app id", () => {
    for (const appId of WORKSPACE_APP_IDS) {
      expect(workspaceAppIconUiSrc(appId)).toBe(`/app-icons/${appId}.svg`);
    }
  });
});

describe("workspaceAppIconManifestSrc", () => {
  it("points at vector SVG for web app manifests", () => {
    expect(workspaceAppIconManifestSrc("mail")).toBe("/app-icons/mail.svg");
  });
});

describe("workspaceAppIconAppleTouchSrc", () => {
  it("points at 180px PNG for iOS apple-touch-icon only", () => {
    expect(workspaceAppIconAppleTouchSrc("mail")).toBe("/pwa-icons/mail-180.png");
  });
});

describe("WORKSPACE_APP_ACCENT", () => {
  it("defines an accent for every workspace app", () => {
    for (const appId of WORKSPACE_APP_IDS) {
      expect(WORKSPACE_APP_ACCENT[appId]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("samples contacts from the purple launcher tile", () => {
    expect(WORKSPACE_APP_ACCENT.contacts.toLowerCase()).toBe("#962fa8");
    expect(WORKSPACE_APP_ACCENT.contacts).not.toMatch(/#8b6f45/i);
  });

  it("samples notes from brand yellow #ffc800", () => {
    expect(WORKSPACE_APP_ACCENT.notes.toLowerCase()).toBe("#ffc800");
    expect(WORKSPACE_APP_ACCENT.notes).not.toMatch(/#f6d176/i);
  });
});

describe("workspaceAppLabelFromPath", () => {
  it("capitalizes the suite app id matching the app-switch route", () => {
    expect(workspaceAppLabel("docs")).toBe("Docs");
    expect(workspaceAppLabelFromPath("/docs")).toBe("Docs");
    expect(workspaceAppLabelFromPath("/docs/abc")).toBe("Docs");
    expect(workspaceAppLabelFromPath("/tasks")).toBe("Tasks");
    expect(workspaceAppLabelFromPath("/drive/folder")).toBe("Drive");
    expect(workspaceAppLabelFromPath("/meet/room-1")).toBe("Meet");
  });

  it("falls back to Workspace outside product routes", () => {
    expect(workspaceAppLabelFromPath("/")).toBe("Workspace");
    expect(workspaceAppLabelFromPath("/login")).toBe("Workspace");
    expect(workspaceAppLabelFromPath("/install")).toBe("Workspace");
  });
});
