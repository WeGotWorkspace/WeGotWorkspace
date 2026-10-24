import { describe, expect, it } from "vitest";
import { WORKSPACE_PWA_ICON_CACHE_VERSION, createWorkspacePwaHead } from "@/lib/workspace-pwa-head";
import { WORKSPACE_APP_IDS } from "@/lib/workspace-app-icons";

describe("createWorkspacePwaHead", () => {
  it("links manifest and cache-busted apple-touch PNG for each workspace app", () => {
    for (const appId of WORKSPACE_APP_IDS) {
      const head = createWorkspacePwaHead(appId);
      expect(head.links).toEqual(
        expect.arrayContaining([
          {
            rel: "manifest",
            href: `/manifests/${appId}.webmanifest?v=${WORKSPACE_PWA_ICON_CACHE_VERSION}`,
          },
          {
            rel: "apple-touch-icon",
            sizes: "180x180",
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

  it("leaves the theme-color meta to the document theme sync", () => {
    for (const appId of [...WORKSPACE_APP_IDS, "home" as const]) {
      const head = createWorkspacePwaHead(appId);
      expect(head.meta).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "theme-color" })]),
      );
    }
  });

  it("uses the home shell manifest and icons on the suite route", () => {
    const head = createWorkspacePwaHead("home");
    expect(head.links).toEqual(
      expect.arrayContaining([
        {
          rel: "manifest",
          href: `/manifests/home.webmanifest?v=${WORKSPACE_PWA_ICON_CACHE_VERSION}`,
        },
        {
          rel: "apple-touch-icon",
          sizes: "180x180",
          href: `/pwa-icons/home-180.png?v=${WORKSPACE_PWA_ICON_CACHE_VERSION}`,
        },
        {
          rel: "icon",
          type: "image/svg+xml",
          href: `/app-icons/home-pwa.svg?v=${WORKSPACE_PWA_ICON_CACHE_VERSION}`,
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
