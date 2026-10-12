import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { DocsCollabPresence } from "./docs-collab-presence";

afterEach(() => {
  cleanup();
});

describe("DocsCollabPresence status dots", () => {
  it("marks live peers green and a connecting peer amber, and skips you and warnings", () => {
    const { container } = render(
      <TooltipProvider>
        <DocsCollabPresence
          localUser={{ displayName: "Ada" }}
          peers={[{ id: "1", name: "Bo" }]}
          connectingPeers={[{ id: "2", name: "Cy" }]}
          warningPeers={[{ id: "3", name: "Di" }]}
        />
      </TooltipProvider>,
    );

    const dots = [...container.querySelectorAll("[data-presence]")].map((dot) =>
      dot.getAttribute("data-presence"),
    );
    expect(dots).toEqual(["online", "away"]);
    expect(container.querySelector(".user-avatar__presence--online")).toBeTruthy();
    expect(container.querySelector(".user-avatar__presence--away")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Live with/);
  });
});
