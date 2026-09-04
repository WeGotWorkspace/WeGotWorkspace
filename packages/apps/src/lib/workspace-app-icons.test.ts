import { describe, expect, it } from "vitest";
import {
  WORKSPACE_APP_ACCENT,
  WORKSPACE_APP_IDS,
  workspaceAppIconAppleTouchSrc,
  workspaceAppIconManifestSrc,
  workspaceAppIconUiSrc,
} from "@/lib/workspace-app-icons";
import { WORKSPACE_APP_ICON_INLINE } from "@/lib/workspace-app-icon-svgs";

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
    const pathSets = WORKSPACE_APP_IDS.map(
      (appId) =>
        [
          appId,
          [...WORKSPACE_APP_ICON_INLINE[appId].matchAll(/d="([^"]+)"/g)].map((m) => m[1]),
        ] as const,
    );

    for (let i = 0; i < pathSets.length; i++) {
      for (let j = i + 1; j < pathSets.length; j++) {
        const [appA, pathsA] = pathSets[i];
        const [appB, pathsB] = pathSets[j];
        expect(JSON.stringify(pathsA)).not.toBe(JSON.stringify(pathsB));
        expect(`${appA} vs ${appB}`).toBeTruthy();
      }
    }
  });

  it("keeps notes as notepad lines, not the contacts person silhouette", () => {
    const notes = WORKSPACE_APP_ICON_INLINE.notes;
    const contacts = WORKSPACE_APP_ICON_INLINE.contacts;

    expect(notes).toContain('d="M337 208H175');
    expect(notes).not.toContain('d="M256 280C284.719');
    expect(contacts).toContain('d="M256 280C284.719');
    expect(contacts).not.toContain('d="M337 208H175');
  });

  it("keeps notes artwork in yellow tints, not white paper or ink", () => {
    const notes = WORKSPACE_APP_ICON_INLINE.notes;

    expect(notes).toContain("#f6d176");
    expect(notes).toContain("#fef8ea");
    expect(notes).toContain("#f0bc3a");
    expect(notes).not.toContain("#fae6b4");
    expect(notes).not.toContain("#f0c55e");
    expect(notes).not.toContain("#f9dea0");
    expect(notes).not.toMatch(/--wai-fg,\s*white/);
    expect(notes).not.toMatch(/#000|#111|#333|#666|#999|#ccc/i);
  });

  it("keeps contacts artwork in mint tints, not brown gold or white paper", () => {
    const contacts = WORKSPACE_APP_ICON_INLINE.contacts;

    expect(contacts).toContain("#39d49b");
    expect(contacts).toContain("#fef8ea");
    expect(contacts).toContain("#26a577");
    expect(contacts).not.toContain("#8B6F45");
    expect(contacts).not.toContain("#8b6f45");
    expect(contacts).not.toContain("#b5c96a");
    expect(contacts).not.toMatch(/--wai-fg,\s*white/);
    expect(contacts).not.toMatch(/#000|#111|#333|#666|#999|#ccc/i);
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

  it("samples contacts from the mint launcher tile, not leftover gold", () => {
    expect(WORKSPACE_APP_ACCENT.contacts.toLowerCase()).toBe("#39d49b");
    expect(WORKSPACE_APP_ACCENT.contacts).not.toMatch(/#8b6f45/i);
  });
});
