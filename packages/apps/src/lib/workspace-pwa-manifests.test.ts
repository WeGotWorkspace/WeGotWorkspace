import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKSPACE_APP_IDS } from "@/lib/workspace-app-icons";
import {
  WORKSPACE_PWA_ICON_CACHE_VERSION,
  WORKSPACE_PWA_THEME_COLOR,
} from "@/lib/workspace-pwa-head";

const manifestsDir = join(import.meta.dirname, "../../public/manifests");

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
};

type WorkspaceManifest = {
  start_url: string;
  scope: string;
  theme_color?: string;
  background_color?: string;
  icons?: ManifestIcon[];
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

  it("cache-busts every manifest icon from the PWA icon version", () => {
    const version = WORKSPACE_PWA_ICON_CACHE_VERSION;

    for (const name of [...WORKSPACE_APP_IDS, "home"]) {
      const manifest = readManifest(name);
      expect(manifest.icons).toEqual([
        {
          src: `/pwa-icons/${name}-192.png?v=${version}`,
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: `/pwa-icons/${name}-512.png?v=${version}`,
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: `/pwa-icons/${name}-512-maskable.png?v=${version}`,
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ]);
    }

    const notes = readFileSync(join(manifestsDir, "notes.webmanifest"), "utf8");
    expect(notes).not.toMatch(/\.svg/);
    expect(notes).not.toMatch(/#f6d176|#f0bc3a|#fef8ea/i);
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

  it("keeps the in-app home mark separate from the / install icon", () => {
    const svg = readFileSync(join(import.meta.dirname, "../../public/app-icons/home.svg"), "utf8");
    const install = readFileSync(
      join(import.meta.dirname, "../../public/app-icons/home-pwa.svg"),
      "utf8",
    );
    const version = WORKSPACE_PWA_ICON_CACHE_VERSION;
    const raw = readFileSync(join(manifestsDir, "home.webmanifest"), "utf8");

    expect(svg).toContain('viewBox="0 0 270 270"');
    expect(svg).toContain('fill="var(--app-icon-layer-surface, #1b1d3a)"');
    expect(svg).toContain('fill="var(--app-icon-layer-foreground, #eeeeee)"');
    expect(svg).not.toContain('width="60"');
    expect(svg).not.toContain("linearGradient");
    expect(install).toContain('viewBox="0 0 60 60"');
    expect(install).toContain('fill="var(--color-we-got-dark, #222222)"');
    expect(install).toContain('stop-color="var(--color-we-got-blue, #0045ff)"');
    expect(install).toContain('stop-color="var(--color-we-got-brat, #8ace00)"');
    expect(install).not.toContain("--wai-");
    expect(raw).toContain(`"/pwa-icons/home-512.png?v=${version}"`);
    expect(raw).not.toMatch(/\.svg/);
  });
});
