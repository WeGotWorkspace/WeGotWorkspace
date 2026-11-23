import { Fragment, useEffect, useRef, type ClipboardEvent, type Ref } from "react";

import { cn } from "@/lib/utils";
import { controlSizeClassName, type ControlSize } from "@/ui/control-size";

import "./otp-input.css";

export type OtpInputProps = {
  id?: string;
  name?: string;
  /** Digits only; anything else is dropped. */
  value: string;
  onChange: (value: string) => void;
  /** Digits in the code. Default 6 (an authenticator app). */
  length?: number;
  size?: ControlSize;
  /** Draw a short dash after every this many boxes (3: `123 – 456`). */
  groupSize?: number;
  /** Disabled while a request runs; the code is not sent twice. */
  disabled?: boolean;
  /** Red outline. Rising to true clears the boxes and focuses the first. */
  invalid?: boolean;
  autoFocus?: boolean;
  /** Set when the last digit is typed or pasted. Default: submit the surrounding form. */
  onComplete?: (value: string) => void;
  "aria-label"?: string;
  "aria-describedby"?: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
};

const digitsOf = (raw: string, length: number) => raw.replace(/\D+/g, "").slice(0, length);

/**
 * A one-time code drawn as separate boxes. One real `<input>` sits on top, so autofill from a
 * message or password manager, paste, and screen readers work as for any text field; the
 * boxes are drawn from its value and hidden from assistive technology.
 */
export function OtpInput({
  id,
  name,
  value,
  onChange,
  length = 6,
  size = "lg",
  groupSize,
  disabled,
  invalid,
  autoFocus,
  onComplete,
  inputRef,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: OtpInputProps) {
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const focused = useRef(false);
  const sent = useRef(false);
  const wasInvalid = useRef(false);
  const refocus = useRef(false);
  const digits = digitsOf(value, length);

  const setRefs = (node: HTMLInputElement | null) => {
    fieldRef.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) inputRef.current = node;
  };

  // Complete once: typing, paste and autofill all land here after the value is committed.
  useEffect(() => {
    if (digits.length < length) {
      sent.current = false;
      return;
    }
    if (sent.current || disabled) return;
    sent.current = true;
    if (onComplete) onComplete(digits);
    else fieldRef.current?.form?.requestSubmit();
  }, [digits, length, disabled, onComplete]);

  // A wrong code: start over from the first box.
  useEffect(() => {
    if (invalid && !wasInvalid.current) {
      // Only a full code was a guess; a short one ("enter all six digits") keeps its digits.
      if (digits.length === length) onChange("");
      refocus.current = true;
    }
    wasInvalid.current = Boolean(invalid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalid]);
  useEffect(() => {
    if (refocus.current && !disabled) {
      refocus.current = false;
      fieldRef.current?.focus();
    }
  }, [disabled, invalid, digits]);

  // `autoFocus` misses a field that mounts disabled (the step appears while its request ends).
  useEffect(() => {
    if (autoFocus && !disabled) fieldRef.current?.focus();
  }, [autoFocus, disabled]);

  const activeIndex = Math.min(digits.length, length - 1);
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = digitsOf(event.clipboardData.getData("text"), length);
    if (pasted) onChange(pasted);
  };

  return (
    <div className={cn("otp-input", className)} data-disabled={disabled ? "" : undefined}>
      <input
        ref={setRefs}
        id={id}
        name={name}
        className="otp-input__field"
        value={digits}
        onChange={(event) => onChange(digitsOf(event.target.value, length))}
        onPaste={paste}
        onFocus={(event) => {
          focused.current = true;
          // The caret stays after the last digit: the active box is where typing lands.
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        onBlur={() => {
          focused.current = false;
        }}
        onSelect={(event) => {
          const end = event.currentTarget.value.length;
          if (
            event.currentTarget.selectionStart !== end ||
            event.currentTarget.selectionEnd !== end
          )
            event.currentTarget.setSelectionRange(end, end);
        }}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={length}
        disabled={disabled}
        required
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
      />
      <div className="otp-input__boxes" aria-hidden="true">
        {Array.from({ length: length }, (_, index) => (
          <Fragment key={index}>
            {groupSize && index > 0 && index % groupSize === 0 ? (
              <span className="otp-input__dash" />
            ) : null}
            <span
              className={cn("input otp-input__box", controlSizeClassName("input", size))}
              data-active={index === activeIndex ? "" : undefined}
              data-filled={index < digits.length ? "" : undefined}
              data-invalid={invalid ? "" : undefined}
            >
              {digits[index] ?? ""}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
