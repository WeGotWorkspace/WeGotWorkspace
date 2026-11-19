/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { TooltipProvider } from "@/ui/tooltip";
import { CollabSessionPresence } from "./collab-session-presence";

afterEach(() => {
  cleanup();
});

describe("CollabSessionPresence", () => {
  it("renders nothing without a session", () => {
    const { container } = render(
      <TooltipProvider>
        <CollabSessionPresence session={null} peers={[{ id: "1", name: "Bo" }]} />
      </TooltipProvider>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows you and the people in the room, in the header look", () => {
    const awareness = new Awareness(new Y.Doc());
    const { container } = render(
      <TooltipProvider>
        <CollabSessionPresence
          variant="header"
          session={{ awareness, user: { name: "Ada", color: "#000" } }}
          peers={[{ id: "1", name: "Bo" }]}
        />
      </TooltipProvider>,
    );
    expect(container.querySelector(".docs-collab-presence-chrome--header")).toBeTruthy();
    expect(container.querySelectorAll("[data-presence='online']")).toHaveLength(1);
    awareness.destroy();
  });
});
