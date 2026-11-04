import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StepDots } from "@/step-dots/src/step-dots";

describe("StepDots", () => {
  it("names the list and describes each dot with its position and status", () => {
    render(
      <StepDots
        steps={["a", "b", "c"]}
        current="b"
        label="Upload steps"
        describeStep={(step, { number, total, status }) => `${step} ${number}/${total} ${status}`}
      />,
    );
    const list = screen.getByRole("list", { name: "Upload steps" });
    const dots = within(list).getAllByRole("listitem");
    expect(dots.map((dot) => dot.textContent)).toEqual([
      "a 1/3 done",
      "b 2/3 current",
      "c 3/3 upcoming",
    ]);
    expect(dots[1]!.getAttribute("aria-current")).toBe("step");
    expect(dots[0]!.getAttribute("aria-current")).toBeNull();
  });
});
