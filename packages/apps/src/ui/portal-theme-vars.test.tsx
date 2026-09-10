import { afterEach, describe, expect, it } from "vitest";
import {
  bridgePortalThemeVars,
  collectCustomPropertyRefs,
  findOpenMenuTrigger,
  PORTAL_THEME_BACKGROUND_VARS,
  PORTAL_THEME_COLOR_VARS,
} from "@/ui/portal-theme-vars";

describe("portal-theme-vars", () => {
  afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  it("exports the outline/accent tokens menus consume", () => {
    expect(PORTAL_THEME_BACKGROUND_VARS).toContain("--button-outline-hover-background");
    expect(PORTAL_THEME_BACKGROUND_VARS).toContain("--button-outline-active-background");
    expect(PORTAL_THEME_COLOR_VARS).toContain("--button-active-color");
    expect(PORTAL_THEME_COLOR_VARS).toContain("--workspace-accent");
  });

  it("parses nested var() references from wash values", () => {
    expect(
      collectCustomPropertyRefs("color-mix(in oklab, var(--notes-detail-accent) 14%, transparent)"),
    ).toEqual(["--notes-detail-accent"]);
    expect(collectCustomPropertyRefs("var(--notes-detail-tint, var(--notes-accent))")).toEqual([
      "--notes-detail-tint",
      "--notes-accent",
    ]);
  });

  it("finds the open select trigger", () => {
    const trigger = document.createElement("button");
    trigger.className = "select-trigger";
    trigger.dataset.state = "open";
    document.body.append(trigger);
    expect(findOpenMenuTrigger()).toBe(trigger);
  });

  it("bridges cascaded outline washes onto the portaled target", () => {
    const source = document.createElement("div");
    source.style.setProperty(
      "--button-outline-hover-background",
      "color-mix(in oklab, var(--calendar-accent) 14%, transparent)",
    );
    source.style.setProperty("--calendar-accent", "#6366f1");
    source.style.setProperty("--button-active-color", "#5558e8");
    document.body.append(source);

    const target = document.createElement("div");
    document.body.append(target);

    bridgePortalThemeVars(source, target);

    expect(target.style.getPropertyValue("--button-outline-hover-background")).toContain(
      "--calendar-accent",
    );
    expect(target.style.getPropertyValue("--calendar-accent").trim()).toBe("#6366f1");
    expect(target.style.getPropertyValue("--button-active-color").trim()).toBe("#5558e8");
  });

  it("walks stylesheet accent chains so Notes-style washes resolve on portals", () => {
    const sheet = document.createElement("style");
    sheet.textContent = `
      .notes-host {
        --notes-accent: #f6d176;
        --notes-detail-accent: var(--notes-accent);
        --notes-detail-accent-strong: color-mix(in oklab, var(--notes-detail-accent) 32%, var(--color-ink));
        --color-ink: #1a1a1a;
        --color-cream: #ffffff;
        --workspace-accent: var(--notes-accent);
        --button-outline-hover-color: var(--notes-detail-accent-strong);
        --button-outline-hover-background: color-mix(in oklab, var(--notes-detail-accent) 14%, transparent);
        --button-outline-active-background: color-mix(in oklab, var(--notes-detail-accent) 18%, var(--color-cream));
        --button-outline-active-hover-background: color-mix(in oklab, var(--notes-detail-accent) 24%, var(--color-cream));
        --button-active-color: var(--notes-detail-accent-strong);
      }
    `;
    document.head.append(sheet);

    const source = document.createElement("button");
    source.className = "notes-host select-trigger";
    document.body.append(source);

    const target = document.createElement("div");
    document.body.append(target);

    bridgePortalThemeVars(source, target);

    expect(target.style.getPropertyValue("--button-outline-hover-background")).toContain(
      "--notes-detail-accent",
    );
    expect(target.style.getPropertyValue("--notes-detail-accent").trim()).toContain(
      "--notes-accent",
    );
    expect(target.style.getPropertyValue("--notes-accent").trim()).toBe("#f6d176");
    expect(target.style.getPropertyValue("--color-cream").trim()).toBe("#ffffff");
    expect(target.style.getPropertyValue("--workspace-accent").trim()).toContain("--notes-accent");
  });
});
