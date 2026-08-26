import * as React from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

import "./input.css";

export type InputSize = "sm" | "md";
export type InputVariant = "default" | "search";

export type InputProps = React.ComponentProps<"input"> & {
  size?: InputSize;
  variant?: InputVariant;
  "data-idle-label"?: string;
};

function assignRef<T>(ref: React.ForwardedRef<T>, node: T | null): void {
  if (typeof ref === "function") {
    ref(node);
    return;
  }
  if (ref) ref.current = node;
}

function emitInputValue(
  onChange: React.ChangeEventHandler<HTMLInputElement> | undefined,
  value: string,
): void {
  onChange?.({
    target: { value },
    currentTarget: { value },
  } as React.ChangeEvent<HTMLInputElement>);
}

function SearchInput({
  className,
  type,
  size,
  value,
  defaultValue,
  onChange,
  dataIdleLabel,
  forwardedRef,
  ...props
}: Omit<InputProps, "variant" | "size" | "ref"> & {
  size: InputSize;
  dataIdleLabel?: string;
  forwardedRef: React.ForwardedRef<HTMLInputElement>;
}): React.JSX.Element {
  const fieldRef = React.useRef<HTMLInputElement | null>(null);
  const isControlled = value !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = React.useState(() =>
    defaultValue == null ? "" : String(defaultValue),
  );
  const currentValue = isControlled ? String(value ?? "") : uncontrolledValue;

  const setFieldRef = (node: HTMLInputElement | null): void => {
    fieldRef.current = node;
    assignRef(forwardedRef, node);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    if (!isControlled) setUncontrolledValue(event.target.value);
    onChange?.(event);
  };

  const handleClear = (): void => {
    if (!isControlled) setUncontrolledValue("");
    const field = fieldRef.current;
    if (field && !isControlled) field.value = "";
    emitInputValue(onChange, "");
  };

  return (
    <div
      className={cn("input input--search", size === "sm" && "input--size-sm", className)}
      data-idle-label={dataIdleLabel}
    >
      <Search className="input__search-icon" aria-hidden />
      <input
        {...props}
        ref={setFieldRef}
        type={type ?? "search"}
        className="input__field"
        value={isControlled ? value : undefined}
        defaultValue={isControlled ? undefined : defaultValue}
        onChange={handleChange}
      />
      {currentValue.length > 0 ? (
        <button
          type="button"
          className="input__clear"
          aria-label="Clear search"
          onClick={handleClear}
        >
          <X className="input__clear-icon" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      size = "md",
      variant = "default",
      value,
      onChange,
      "data-idle-label": dataIdleLabel,
      ...props
    },
    ref,
  ) => {
    if (variant === "search") {
      return (
        <SearchInput
          className={className}
          type={type}
          size={size}
          value={value}
          onChange={onChange}
          dataIdleLabel={dataIdleLabel}
          forwardedRef={ref}
          {...props}
        />
      );
    }

    return (
      <input
        type={type}
        className={cn("input", size === "sm" && "input--size-sm", className)}
        ref={ref}
        value={value}
        onChange={onChange}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
