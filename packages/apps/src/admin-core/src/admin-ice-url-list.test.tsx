import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminIceUrlList } from "@/admin-core/src/admin-ice-url-list";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(() => {
  cleanup();
});

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <TooltipProvider delayDuration={0}>
      <AdminIceUrlList
        id="stun"
        label="STUN URLs"
        itemLabel="STUN URL"
        value={value}
        onChange={setValue}
      />
      <output data-testid="stored">{value}</output>
    </TooltipProvider>
  );
}

const stored = () => screen.getByTestId("stored").textContent;

describe("AdminIceUrlList", () => {
  it("shows one field per url and an empty field to add the next", () => {
    render(<Harness initial="stun:a.example:3478" />);
    expect((screen.getByLabelText("STUN URL 1") as HTMLInputElement).value).toBe(
      "stun:a.example:3478",
    );
    fireEvent.change(screen.getByLabelText("STUN URL 2"), {
      target: { value: "stun:b.example:3478" },
    });
    expect(stored()).toBe("stun:a.example:3478,stun:b.example:3478");
  });

  it("offers no empty field once three urls are entered", () => {
    render(<Harness initial="stun:a.example,stun:b.example,stun:c.example" />);
    expect(screen.getByLabelText("STUN URL 3")).toBeTruthy();
    expect(screen.queryByLabelText("STUN URL 4")).toBeNull();
  });

  it("rejects a typed comma and says one url per field", () => {
    render(<Harness initial="stun:a.example" />);
    fireEvent.change(screen.getByLabelText("STUN URL 1"), {
      target: { value: "stun:a.example,stun:b.example" },
    });
    expect(stored()).toBe("stun:a.example");
    expect(screen.getByText(/one URL per field/i)).toBeTruthy();
  });

  it("rejects pasted text that contains a comma", () => {
    render(<Harness initial="" />);
    const field = screen.getByLabelText("STUN URL 1");
    const pasted = fireEvent.paste(field, {
      clipboardData: { getData: () => "stun:a.example,stun:b.example" },
    });
    expect(pasted).toBe(false);
    expect(stored()).toBe("");
    expect(screen.getByText(/one URL per field/i)).toBeTruthy();
  });

  it("removes a url with its remove button", () => {
    render(<Harness initial="stun:a.example,stun:b.example" />);
    fireEvent.click(screen.getByLabelText("Remove STUN URL 1"));
    expect(stored()).toBe("stun:b.example");
  });

  it("keeps a stored list longer than three visible and says only three are used", () => {
    render(<Harness initial="stun:a.example,stun:b.example,stun:c.example,stun:d.example" />);
    expect(screen.getByLabelText("STUN URL 4")).toBeTruthy();
    expect(screen.queryByLabelText("STUN URL 5")).toBeNull();
    expect(screen.getByText(/only the first 3 are used/i)).toBeTruthy();
  });
});
