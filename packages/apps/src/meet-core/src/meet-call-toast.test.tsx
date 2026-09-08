/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAppToast } from "@/hooks/use-app-toast";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { AppToaster } from "@/ui/sonner";

function LeaveToastProbe() {
  const toast = useAppToast();
  return (
    <>
      <AppToaster />
      <button
        type="button"
        onClick={() => toast.show(meetLabels.participantLeft("Admin"), { severity: "info" })}
      >
        Fire leave
      </button>
    </>
  );
}

describe("Meet call toast surface", () => {
  it("renders a Callout toast, not a raw Sonner text node", async () => {
    render(<LeaveToastProbe />);

    await screen.findByRole("region", { name: /notifications/i });
    fireEvent.click(screen.getByRole("button", { name: "Fire leave" }));

    const title = await screen.findByText(meetLabels.participantLeft("Admin"));
    const callout = title.closest(".callout");
    expect(callout).not.toBeNull();
    expect(callout?.classList.contains("callout--info")).toBe(true);
  });
});
