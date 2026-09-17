/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useInboxBadgePulseAttr } from "./use-inbox-badge-pulse";

function Probe({ nonce }: { nonce: number }) {
  const attr = useInboxBadgePulseAttr(nonce);
  return <span data-testid="pulse" data-pulse={attr} />;
}

describe("useInboxBadgePulseAttr", () => {
  afterEach(() => {
    cleanup();
  });

  it("stays unset for the initial seed nonce and sets data-pulse on later arrivals", async () => {
    const { rerender, getByTestId } = render(<Probe nonce={0} />);
    expect(getByTestId("pulse").getAttribute("data-pulse")).toBeNull();

    rerender(<Probe nonce={1} />);
    await waitFor(() => {
      expect(getByTestId("pulse").getAttribute("data-pulse")).toBe("1");
    });

    rerender(<Probe nonce={2} />);
    await waitFor(() => {
      expect(getByTestId("pulse").getAttribute("data-pulse")).toBe("2");
    });
  });
});
