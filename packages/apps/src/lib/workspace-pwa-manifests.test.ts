import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKSPACE_APP_IDS } from "@/lib/workspace-app-icons";
import {
  WORKSPACE_PWA_ICON_CACHE_VERSION,
  WORKSPACE_PWA_THEME_COLOR,
} from "@/lib/workspace-pwa-head";

const manifestsDir = join(import.meta.dirname, "../../public/manifests");

type WorkspaceManifest = {
  start_url: string;
  scope: string;
  theme_color?: string;
  background_color?: string;
};

function readManifest(name: string): WorkspaceManifest {
  return JSON.parse(
    readFileSync(join(manifestsDir, `${name}.webmanifest`), "utf8"),
  ) as WorkspaceManifest;
}

describe("workspace PWA manifests", () => {
  it("uses canonical list landing paths for multi-segment apps", () => {
    expect(readManifest("notes")).toMatchObject({
      start_url: "/notes/all",
      scope: "/notes",
    });
    expect(readManifest("contacts")).toMatchObject({
      start_url: "/contacts/all",
      scope: "/contacts",
    });
    expect(readManifest("tasks")).toMatchObject({
      start_url: "/tasks/lists/inbox",
      scope: "/tasks",
    });
  });

  it("cache-busts the notes manifest icons with the PWA icon version", () => {
    const raw = readFileSync(join(manifestsDir, "notes.webmanifest"), "utf8");
    const version = WORKSPACE_PWA_ICON_CACHE_VERSION;

    expect(raw).toContain(`"/app-icons/notes.svg?v=${version}"`);
    expect(raw).toContain(`"/pwa-icons/notes-180.png?v=${version}"`);
    expect(raw).not.toMatch(/#f6d176|#f0bc3a|#fef8ea/i);
  });

  it("paints every installed window with the sand UI accent", () => {
    const styles = readFileSync(join(import.meta.dirname, "../styles.css"), "utf8");
    expect(styles).toContain(`--color-we-got-sand: ${WORKSPACE_PWA_THEME_COLOR};`);

    for (const name of [...WORKSPACE_APP_IDS, "home"]) {
      const manifest = readManifest(name);
      expect(manifest.theme_color).toBe(WORKSPACE_PWA_THEME_COLOR);
      expect(manifest.background_color).toBe(WORKSPACE_PWA_THEME_COLOR);
    }
  });

  it("publishes a full-bleed home svg instead of a 60px mark", () => {
    const svg = readFileSync(join(import.meta.dirname, "../../public/app-icons/home.svg"), "utf8");
    const version = WORKSPACE_PWA_ICON_CACHE_VERSION;
    const raw = readFileSync(join(manifestsDir, "home.webmanifest"), "utf8");

    expect(svg).toContain('viewBox="0 0 270 270"');
    expect(svg).toContain('fill="var(--wai-bg, #1b1d3a)"');
    expect(svg).toContain('fill="var(--wai-fg, #fff5e9)"');
    expect(svg).not.toContain('width="60"');
    expect(raw).toContain(`"/app-icons/home.svg?v=${version}"`);
    expect(raw).toContain(`"/pwa-icons/home-180.png?v=${version}"`);
  });
});
