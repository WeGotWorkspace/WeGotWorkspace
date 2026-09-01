import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FieldLabelRow } from "@/ui/field-label-row";

afterEach(() => {
  cleanup();
});

describe("FieldLabelRow", () => {
  it("associates a visible caption with the control via htmlFor", () => {
    render(
      <FieldLabelRow label="Street" htmlFor="contact-street">
        <input id="contact-street" />
      </FieldLabelRow>,
    );

    const field = screen.getByLabelText("Street");
    expect(field).toBeTruthy();
    expect(field.getAttribute("id")).toBe("contact-street");
    expect(screen.getByText("Street").getAttribute("aria-hidden")).toBeNull();
  });

  it("reserves the label band when label is empty so neighbors share a baseline", () => {
    const { container } = render(
      <div className="grid">
        <FieldLabelRow label="" htmlFor="contact-type">
          <input id="contact-type" aria-label="Type" />
        </FieldLabelRow>
        <FieldLabelRow label="Street" htmlFor="contact-street">
          <input id="contact-street" />
        </FieldLabelRow>
      </div>,
    );

    const labels = container.querySelectorAll(".field-label-row__label");
    expect(labels).toHaveLength(2);

    const reserved = labels[0];
    expect(reserved?.classList.contains("field-label-row__label--reserved")).toBe(true);
    expect(reserved?.getAttribute("aria-hidden")).toBe("true");
    expect(reserved?.getAttribute("for")).toBeNull();
    expect(reserved?.textContent).toBe("\u00a0");

    expect(labels[1]?.classList.contains("field-label-row__label--reserved")).toBe(false);
    expect(screen.getByLabelText("Type")).toBeTruthy();
    expect(screen.getByLabelText("Street")).toBeTruthy();
  });

  it("reserves the same band via reserveLabel without a caption", () => {
    const { container } = render(
      <FieldLabelRow reserveLabel htmlFor="contact-type">
        <input id="contact-type" aria-label="Type" />
      </FieldLabelRow>,
    );

    const reserved = container.querySelector(".field-label-row__label");
    expect(reserved).not.toBeNull();
    expect(reserved?.classList.contains("field-label-row__label--reserved")).toBe(true);
    expect(reserved?.getAttribute("aria-hidden")).toBe("true");
    expect(reserved?.getAttribute("for")).toBeNull();
    expect(screen.queryByText("Type", { selector: "label" })).toBeNull();
    expect(screen.getByLabelText("Type")).toBeTruthy();
  });

  it("does not render a label band when neither label nor reserveLabel is set", () => {
    const { container } = render(
      <FieldLabelRow>
        <input aria-label="Notes" />
      </FieldLabelRow>,
    );

    expect(container.querySelector(".field-label-row__label")).toBeNull();
    expect(screen.getByLabelText("Notes")).toBeTruthy();
  });

  it("keeps a visible caption when reserveLabel is set alongside label text", () => {
    render(
      <FieldLabelRow label="Street" reserveLabel htmlFor="contact-street">
        <input id="contact-street" />
      </FieldLabelRow>,
    );

    const caption = screen.getByText("Street");
    expect(caption.classList.contains("field-label-row__label--reserved")).toBe(false);
    expect(caption.getAttribute("aria-hidden")).toBeNull();
    expect(screen.getByLabelText("Street")).toBeTruthy();
  });
});
