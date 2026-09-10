import { afterEach, describe, expect, it } from "vitest";
import {
  bridgePortalThemeVars,
  findOpenMenuTrigger,
  PORTAL_THEME_BACKGROUND_VARS,
  PORTAL_THEME_COLOR_VARS,
} from "@/ui/portal-theme-vars";

describe("portal-theme-vars", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("exports the outline/accent tokens menus consume", () => {
    expect(PORTAL_THEME_BACKGROUND_VARS).toContain("--button-outline-hover-background");
    expect(PORTAL_THEME_BACKGROUND_VARS).toContain("--button-outline-active-background");
    expect(PORTAL_THEME_COLOR_VARS).toContain("--button-active-color");
    expect(PORTAL_THEME_COLOR_VARS).toContain("--workspace-accent");
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
});
