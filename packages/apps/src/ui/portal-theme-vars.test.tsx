import { afterEach, describe, expect, it } from "vitest";
import {
  bridgePortalThemeFromOpenTrigger,
  bridgePortalThemeVars,
  collectCustomPropertyRefs,
  findOpenMenuTrigger,
  findTriggerForPortaledContent,
  isResolvedCssColor,
  PORTAL_THEME_BACKGROUND_VARS,
  PORTAL_THEME_COLOR_VARS,
  resolveCustomPropertyColor,
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

  it("finds the trigger that owns a portaled content via aria-controls", () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-controls", "radix-select-content-1");
    document.body.append(trigger);

    const content = document.createElement("div");
    content.id = "radix-select-content-1";
    document.body.append(content);

    expect(findTriggerForPortaledContent(content)).toBe(trigger);
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

    expect(target.style.getPropertyValue("--button-outline-hover-background")).toMatch(
      /calendar-accent|#6366f1|rgba?\(|oklch\(/i,
    );
    expect(target.style.getPropertyValue("--calendar-accent").trim()).toBe("#6366f1");
    expect(target.style.getPropertyValue("--button-active-color").trim()).toMatch(
      /#5558e8|rgba?\(|oklch\(/i,
    );
  });

  it("walks stylesheet accent chains so Notes-style washes resolve on portals", () => {
    const sheet = document.createElement("style");
    sheet.textContent = `
      .notes-host {
        --notes-accent: #f6d176;
        --notes-accent-strong: color-mix(in oklab, var(--notes-accent) 32%, var(--color-ink));
        --color-ink: #1a1a1a;
        --color-cream: #ffffff;
        --workspace-accent: var(--notes-accent);
        --button-outline-hover-color: var(--notes-accent-strong);
        --button-outline-hover-background: color-mix(in oklab, var(--notes-accent) 14%, transparent);
        --button-outline-active-background: color-mix(in oklab, var(--notes-accent) 18%, var(--color-cream));
        --button-outline-active-hover-background: color-mix(in oklab, var(--notes-accent) 24%, var(--color-cream));
        --button-active-color: var(--notes-accent-strong);
      }
    `;
    document.head.append(sheet);

    const source = document.createElement("button");
    source.className = "notes-host select-trigger";
    document.body.append(source);

    const target = document.createElement("div");
    document.body.append(target);

    bridgePortalThemeVars(source, target);

    const hover = target.style.getPropertyValue("--button-outline-hover-background");
    expect(hover).toMatch(/notes-accent|#f6d176|rgba?\(|oklch\(/i);
    expect(hover.toLowerCase()).not.toMatch(/color-ink/);
    expect(hover).not.toMatch(/notes-detail/);
    expect(target.style.getPropertyValue("--notes-accent").trim()).toBe("#f6d176");
    expect(target.style.getPropertyValue("--color-cream").trim()).toBe("#ffffff");
    expect(target.style.getPropertyValue("--workspace-accent").trim()).toMatch(
      /notes-accent|#f6d176|rgba?\(|oklch\(/i,
    );
  });

  it("bridges Calendar stylesheet washes without falling back to ink-gray", () => {
    const sheet = document.createElement("style");
    sheet.textContent = `
      .calendar-host {
        --calendar-accent: #6366f1;
        --calendar-accent-strong: #5558e8;
        --color-ink: #1a1a1a;
        --color-cream: #ffffff;
        --workspace-accent: var(--calendar-accent);
        --button-outline-hover-background: color-mix(in oklab, var(--calendar-accent) 14%, transparent);
        --button-outline-active-background: color-mix(in oklab, var(--calendar-accent) 18%, var(--color-cream));
        --button-outline-active-hover-background: color-mix(in oklab, var(--calendar-accent) 24%, var(--color-cream));
        --button-active-color: var(--calendar-accent-strong);
        --button-outline-hover-color: var(--calendar-accent-strong);
      }
    `;
    document.head.append(sheet);

    const source = document.createElement("button");
    source.className = "calendar-host select-trigger";
    source.dataset.state = "open";
    document.body.append(source);

    const target = document.createElement("div");
    target.id = "calendar-select-content";
    document.body.append(target);
    source.setAttribute("aria-controls", target.id);

    bridgePortalThemeFromOpenTrigger(target);

    const hover = target.style.getPropertyValue("--button-outline-hover-background");
    expect(hover.trim().length).toBeGreaterThan(0);
    expect(hover.toLowerCase()).not.toMatch(/color-ink/);
    expect(hover).toMatch(/calendar-accent|#6366f1|rgba?\(|oklch\(/i);
    expect(target.style.getPropertyValue("--calendar-accent").trim()).toBe("#6366f1");
  });

  it("overwrites seed washes with concrete colors when the engine resolves them", () => {
    const source = document.createElement("div");
    // Hex washes resolve even in jsdom (no color-mix required).
    source.style.setProperty("--button-outline-hover-background", "#f6d176");
    source.style.setProperty("--button-outline-active-background", "#f0c85a");
    source.style.setProperty("--button-outline-active-hover-background", "#e8bc40");
    source.style.setProperty("--button-active-color", "#8a6a10");
    source.style.setProperty("--button-outline-hover-color", "#8a6a10");
    source.style.setProperty("--button-outline-color", "#1a1a1a");
    source.style.setProperty("--workspace-accent", "#f6d176");
    document.body.append(source);

    const target = document.createElement("div");
    document.body.append(target);

    bridgePortalThemeVars(source, target);

    const hover = target.style.getPropertyValue("--button-outline-hover-background").trim();
    expect(hover === "#f6d176" || isResolvedCssColor(hover)).toBe(true);
    expect(hover.toLowerCase()).not.toContain("color-ink");

    // Engines that resolve `background-color: var(--token)` (browsers) return a
    // concrete color from the portaled host; jsdom often echoes the var() string.
    const probed = resolveCustomPropertyColor(target, "--button-outline-hover-background");
    expect(
      probed === "#f6d176" ||
        isResolvedCssColor(probed) ||
        probed.includes("--button-outline-hover-background"),
    ).toBe(true);
  });
});
