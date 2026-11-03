import { describe, expect, it } from "vitest";
import {
  WORKSPACE_APP_ACCENT,
  WORKSPACE_APP_IDS,
  workspaceAppIconAppleTouchSrc,
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
    expect(workspaceAppIconUiSrc("tasks")).toBe("/app-icons/tasks.svg");
  });
});

describe("WORKSPACE_APP_ICON_INLINE", () => {
  it("bundles inline SVG markup for every workspace app", () => {
    for (const appId of WORKSPACE_APP_IDS) {
      expect(WORKSPACE_APP_ICON_INLINE[appId]).toMatch(/^<svg[\s>]/);
      expect(WORKSPACE_APP_ICON_INLINE[appId]).toContain("--app-icon-layer-surface");
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
      // Background layer is the first rect/path with --app-icon-layer-surface; it must not use tile rx.
      const bgLayer = markup.match(
        /<(?:rect|path)[^>]*fill="var\(--app-icon-layer-surface[^"]*"[^>]*\/?>|<(?:rect|path)[^>]*rx="45"[^>]*fill="var\(--app-icon-layer-surface/,
      )?.[0];
      expect(bgLayer, `${appId} should have a --app-icon-layer-surface layer`).toBeTruthy();
      expect(bgLayer).not.toMatch(/\brx="/);
      expect(markup).not.toMatch(/<(?:rect|path)[^>]*\brx="45"/);
    }
  });

  it("keeps notes as the yellow notepad, not the contacts person", () => {
    const notes = WORKSPACE_APP_ICON_INLINE.notes;
    const contacts = WORKSPACE_APP_ICON_INLINE.contacts;

    expect(notes).toContain('d="M28 43a2 2 0');
    expect(notes).toContain("#ffc800");
    expect(notes).toContain("#ffea9f");
    expect(notes).not.toContain("44.868");
    expect(contacts).toContain("44.868");
    expect(contacts).toContain("#a3c4e8");
    expect(contacts).toContain("#d7eafe");
    expect(contacts).not.toContain('d="M28 43a2 2 0');
    expect(contacts).not.toContain('d="M256 280C284.719');
  });
});

describe("WORKSPACE_HOME_ICON_INLINE", () => {
  it("is a 60 suite tile: dark background, soft clover, brand tokens", () => {
    expect(WORKSPACE_HOME_ICON_INLINE).toMatch(/^<svg[\s>]/);
    expect(WORKSPACE_HOME_ICON_INLINE).toContain('viewBox="0 0 60 60"');
    expect(WORKSPACE_HOME_ICON_INLINE).toContain(
      'fill="var(--app-icon-layer-surface, var(--color-we-got-dark, #003311))"',
    );
    expect(WORKSPACE_HOME_ICON_INLINE).toContain(
      'fill="var(--app-icon-layer-foreground, var(--color-we-got-soft, #fff5e9))"',
    );
    expect(WORKSPACE_HOME_ICON_INLINE).toContain('d="M40 30c5.523 0 10-4.477 10-10');
    expect(WORKSPACE_HOME_ICON_INLINE).not.toContain('viewBox="0 0 270 270"');
    expect(WORKSPACE_HOME_ICON_INLINE).not.toContain("linearGradient");
    expect(WORKSPACE_HOME_ICON_INLINE).not.toContain("250.643");
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

describe("workspaceAppIconAppleTouchSrc", () => {
  it("points at 180px PNG for iOS apple-touch-icon only", () => {
    expect(workspaceAppIconAppleTouchSrc("tasks")).toBe("/pwa-icons/tasks-180.png");
  });
});

describe("WORKSPACE_APP_ACCENT", () => {
  it("defines an accent for every workspace app", () => {
    for (const appId of WORKSPACE_APP_IDS) {
      expect(WORKSPACE_APP_ACCENT[appId]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("samples contacts from the sky launcher tile", () => {
    expect(WORKSPACE_APP_ACCENT.contacts.toLowerCase()).toBe("#a3c4e8");
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
