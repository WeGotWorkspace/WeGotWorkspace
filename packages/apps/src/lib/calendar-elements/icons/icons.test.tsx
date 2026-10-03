import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { renderCalendarIcon } from "./CalendarIcon.js";
import { renderGridIcon } from "./GridIcon.js";
import { renderHamburgerIcon } from "./HamburgerIcon.js";
import { renderListIcon } from "./ListIcon.js";
import { renderPlusIcon } from "./PlusIcon.js";

const icons = [
  ["calendar", renderCalendarIcon],
  ["grid", renderGridIcon],
  ["hamburger", renderHamburgerIcon],
  ["list", renderListIcon],
  ["plus", renderPlusIcon],
] as const;

function draw(renderIcon: (options?: { className?: string }) => unknown, className?: string) {
  const host = document.createElement("div");
  document.body.append(host);
  render(renderIcon(className === undefined ? undefined : { className }) as never, host);
  const svg = host.querySelector("svg");
  expect(svg).toBeTruthy();
  return svg as SVGSVGElement;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe.each(icons)("%s icon", (_name, renderIcon) => {
  it("is decorative and drawn on the shared 24x24 grid", () => {
    const svg = draw(renderIcon);

    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("class")).toBe("");
  });

  it("takes the caller's class name", () => {
    expect(draw(renderIcon, "event-calendar-nav-icon").getAttribute("class")).toBe(
      "event-calendar-nav-icon",
    );
  });
});
