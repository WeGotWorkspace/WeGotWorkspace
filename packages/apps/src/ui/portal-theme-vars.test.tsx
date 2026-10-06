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
  portaledSurfaceElement,
  resolveCustomPropertyColor,
} from "@/ui/portal-theme-vars";

describe("portal-theme-vars", () => {
  afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  it("exports the outline/accent tokens menus consume", () => {
    expect(PORTAL_THEME_BACKGROUND_VARS).toContain("--menu-item-hover-background");
    expect(PORTAL_THEME_BACKGROUND_VARS).toContain("--menu-item-selected-background");
    expect(PORTAL_THEME_BACKGROUND_VARS).toContain("--menu-item-selected-hover-background");
    expect(PORTAL_THEME_BACKGROUND_VARS).toContain("--button-outline-hover-background");
    expect(PORTAL_THEME_BACKGROUND_VARS).toContain("--button-outline-active-background");
    expect(PORTAL_THEME_COLOR_VARS).toContain("--button-active-color");
    expect(PORTAL_THEME_COLOR_VARS).toContain("--workspace-accent");
    expect(PORTAL_THEME_COLOR_VARS).toContain("--workspace-foreground");
    expect(PORTAL_THEME_COLOR_VARS).toContain("--workspace-surface");
    expect(PORTAL_THEME_COLOR_VARS).toContain("--popover-foreground");
  });

  it("parses nested var() references from wash values", () => {
    expect(
      collectCustomPropertyRefs("color-mix(in oklab, var(--notes-detail-accent) 14%, transparent)"),
    ).toEqual(["--notes-detail-accent"]);
    expect(collectCustomPropertyRefs("var(--notes-detail-tint, var(--workspace-accent))")).toEqual([
      "--notes-detail-tint",
      "--workspace-accent",
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

  it("finds a tooltip trigger via aria-describedby", () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-describedby", "radix-tooltip-1");
    trigger.dataset.state = "instant-open";
    document.body.append(trigger);

    const content = document.createElement("div");
    content.id = "radix-tooltip-1";
    document.body.append(content);

    expect(findTriggerForPortaledContent(content)).toBe(trigger);
  });

  it("copies the paper pair onto a tooltip without painting the paper fill", () => {
    const host = document.createElement("div");
    host.className = "workspace-app-layout__main";
    host.style.backgroundColor = "rgb(20, 20, 20)";
    host.style.setProperty("--workspace-foreground", "#ffffff");
    host.style.setProperty("--workspace-surface", "#141414");
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-describedby", "radix-tooltip-chip");
    host.append(trigger);
    document.body.append(host);

    const content = document.createElement("div");
    content.id = "radix-tooltip-chip";
    document.body.append(content);

    bridgePortalThemeFromOpenTrigger(content, { paintSurface: false });

    expect(content.style.getPropertyValue("--workspace-foreground").trim()).toBe("#ffffff");
    expect(content.style.getPropertyValue("--workspace-surface").trim()).toBe("#141414");
    expect(content.style.backgroundColor).toBe("");
  });

  it("bridges cascaded outline washes onto the portaled target", () => {
    const source = document.createElement("div");
    source.style.setProperty(
      "--button-outline-hover-background",
      "color-mix(in oklab, var(--workspace-accent) 14%, transparent)",
    );
    source.style.setProperty("--workspace-accent", "#962fa8");
    source.style.setProperty("--button-active-color", "#5a1c66");
    document.body.append(source);

    const target = document.createElement("div");
    document.body.append(target);

    bridgePortalThemeVars(source, target);

    expect(target.style.getPropertyValue("--button-outline-hover-background")).toMatch(
      /workspace-accent|#962fa8|rgba?\(|oklch\(/i,
    );
    expect(target.style.getPropertyValue("--workspace-accent").trim()).toBe("#962fa8");
    expect(target.style.getPropertyValue("--button-active-color").trim()).toMatch(
      /#5a1c66|rgba?\(|oklch\(/i,
    );
  });

  it("walks stylesheet accent chains so Notes-style washes resolve on portals", () => {
    const sheet = document.createElement("style");
    sheet.textContent = `
      .notes-host {
        --workspace-accent: #ffc800;
        --workspace-accent-strong: color-mix(in oklab, var(--workspace-accent) 32%, var(--color-we-got-dark));
        --color-we-got-dark: #1a1a1a;
        --color-we-got-soft: #fff5e9;
        --button-outline-hover-color: var(--workspace-accent-strong);
        --button-outline-hover-background: color-mix(in oklab, var(--workspace-accent) 14%, transparent);
        --button-outline-active-background: color-mix(in oklab, var(--workspace-accent) 18%, var(--color-we-got-soft));
        --button-outline-active-hover-background: color-mix(in oklab, var(--workspace-accent) 24%, var(--color-we-got-soft));
        --button-active-color: var(--workspace-accent-strong);
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
    expect(hover).toMatch(/workspace-accent|#ffc800|rgba?\(|oklch\(/i);
    expect(hover.toLowerCase()).not.toMatch(/color-ink/);
    expect(hover).not.toMatch(/notes-detail/);
    expect(target.style.getPropertyValue("--workspace-accent").trim()).toBe("#ffc800");
    expect(target.style.getPropertyValue("--color-we-got-soft").trim()).toBe("#fff5e9");
    expect(target.style.getPropertyValue("--workspace-accent").trim()).toMatch(
      /workspace-accent|#ffc800|rgba?\(|oklch\(/i,
    );
  });

  it("bridges Calendar stylesheet washes without falling back to ink-gray", () => {
    const sheet = document.createElement("style");
    sheet.textContent = `
      .calendar-host {
        --workspace-accent: #962fa8;
        --workspace-accent-strong: color-mix(in oklab, var(--workspace-accent) 32%, var(--color-we-got-dark));
        --color-we-got-dark: #1a1a1a;
        --color-we-got-soft: #fff5e9;
        --button-outline-hover-background: color-mix(in oklab, var(--workspace-accent) 14%, transparent);
        --button-outline-active-background: color-mix(in oklab, var(--workspace-accent) 18%, var(--color-we-got-soft));
        --button-outline-active-hover-background: color-mix(in oklab, var(--workspace-accent) 24%, var(--color-we-got-soft));
        --button-active-color: var(--workspace-accent-strong);
        --button-outline-hover-color: var(--workspace-accent-strong);
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
    expect(hover).toMatch(/workspace-accent|#962fa8|rgba?\(|oklch\(/i);
    expect(target.style.getPropertyValue("--workspace-accent").trim()).toBe("#962fa8");
  });

  it("paints a portaled menu with the dialog paper, otherwise the main paper", () => {
    const main = document.createElement("div");
    main.className = "workspace-app-layout__main";
    main.style.backgroundColor = "rgb(255, 251, 246)";
    main.style.color = "rgb(0, 51, 17)";
    main.style.setProperty("--workspace-foreground", "#003311");
    const dialog = document.createElement("div");
    dialog.className = "overlay-paper";
    dialog.style.backgroundColor = "rgb(255, 248, 228)";
    const mainTrigger = document.createElement("button");
    mainTrigger.className = "select-trigger";
    mainTrigger.dataset.state = "open";
    main.append(mainTrigger);
    const dialogTrigger = document.createElement("button");
    dialogTrigger.id = "dialog-select";
    dialog.append(dialogTrigger);
    document.body.append(main, dialog);

    expect(portaledSurfaceElement(mainTrigger)).toBe(main);
    expect(portaledSurfaceElement(dialogTrigger)).toBe(dialog);

    const mainMenu = document.createElement("div");
    mainMenu.id = "main-menu";
    mainTrigger.setAttribute("aria-controls", mainMenu.id);
    document.body.append(mainMenu);
    bridgePortalThemeFromOpenTrigger(mainMenu);
    expect(mainMenu.style.backgroundColor).toBe("rgb(255, 251, 246)");
    expect(mainMenu.style.getPropertyValue("--color-popover").trim()).toBe("rgb(255, 251, 246)");
    expect(mainMenu.style.getPropertyValue("--popover-foreground").trim()).toMatch(
      /#003311|rgb\(0,\s*51,\s*17\)/,
    );

    const dialogMenu = document.createElement("div");
    dialogMenu.id = "dialog-menu";
    dialogTrigger.setAttribute("aria-controls", dialogMenu.id);
    document.body.append(dialogMenu);
    bridgePortalThemeFromOpenTrigger(dialogMenu);
    expect(dialogMenu.style.backgroundColor).toBe("rgb(255, 248, 228)");
  });

  it("paints the app-switch menu with the sidebar fill", () => {
    const sidebar = document.createElement("aside");
    sidebar.className = "app-sidebar";
    sidebar.style.backgroundColor = "rgb(255, 242, 243)";
    const trigger = document.createElement("button");
    trigger.className = "app-switch-button__trigger";
    trigger.dataset.state = "open";
    sidebar.append(trigger);
    const main = document.createElement("div");
    main.className = "workspace-app-layout__main";
    main.style.backgroundColor = "rgb(255, 251, 246)";
    document.body.append(sidebar, main);

    expect(portaledSurfaceElement(trigger)).toBe(sidebar);

    const menu = document.createElement("div");
    menu.id = "app-switch-menu";
    trigger.setAttribute("aria-controls", menu.id);
    document.body.append(menu);
    bridgePortalThemeFromOpenTrigger(menu);
    expect(menu.style.backgroundColor).toBe("rgb(255, 242, 243)");
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
    expect(hover.toLowerCase()).not.toContain("color-we-got-dark");

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
