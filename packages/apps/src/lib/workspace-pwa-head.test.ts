import { describe, expect, it } from "vitest";
import {
  WORKSPACE_PWA_ICON_CACHE_VERSION,
  WORKSPACE_PWA_THEME_COLOR,
  createWorkspacePwaHead,
} from "@/lib/workspace-pwa-head";
import { WORKSPACE_APP_IDS } from "@/lib/workspace-app-icons";

describe("createWorkspacePwaHead", () => {
  it("links manifest and cache-busted apple-touch PNG for each workspace app", () => {
    for (const appId of WORKSPACE_APP_IDS) {
      if (appId === "mail") continue;
      const head = createWorkspacePwaHead(appId);
      expect(head.links).toEqual(
        expect.arrayContaining([
          { rel: "manifest", href: `/manifests/${appId}.webmanifest` },
          {
            rel: "apple-touch-icon",
            href: `/pwa-icons/${appId}-180.png?v=${WORKSPACE_PWA_ICON_CACHE_VERSION}`,
          },
          {
            rel: "icon",
            type: "image/svg+xml",
            href: `/app-icons/${appId}.svg?v=${WORKSPACE_PWA_ICON_CACHE_VERSION}`,
          },
        ]),
      );
    }
  });

  it("sets the sand theme-color meta for each workspace app and the home shell", () => {
    for (const appId of [...WORKSPACE_APP_IDS.filter((id) => id !== "mail"), "home" as const]) {
      const head = createWorkspacePwaHead(appId);
      expect(head.meta).toEqual(
        expect.arrayContaining([{ name: "theme-color", content: WORKSPACE_PWA_THEME_COLOR }]),
      );
    }
  });

  it("uses the home shell manifest and icons on the suite route", () => {
    const head = createWorkspacePwaHead("home");
    expect(head.links).toEqual(
      expect.arrayContaining([
        { rel: "manifest", href: "/manifests/home.webmanifest" },
        {
          rel: "apple-touch-icon",
          href: `/pwa-icons/home-180.png?v=${WORKSPACE_PWA_ICON_CACHE_VERSION}`,
        },
        {
          rel: "icon",
          type: "image/svg+xml",
          href: `/app-icons/home.svg?v=${WORKSPACE_PWA_ICON_CACHE_VERSION}`,
        },
      ]),
    );
  });

  it("allows title and description overrides for auth and guest routes", () => {
    const head = createWorkspacePwaHead("home", {
      title: "Sign in — WeGotWorkspace",
      description: "Sign in to your workspace to continue.",
    });

    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "Sign in — WeGotWorkspace" },
        { name: "description", content: "Sign in to your workspace to continue." },
      ]),
    );
  });
});
