import * as React from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { controlSizeClassName, type ControlSize } from "@/ui/control-size";

import "./input.css";

export type InputSize = ControlSize;
export type InputVariant = "default" | "search";

export type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  /** Height, padding, and font-size. Radius is global `--control-radius`. Default `md` = 36px. */
  size?: InputSize;
  variant?: InputVariant;
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
  forwardedRef,
  ...props
}: Omit<InputProps, "variant" | "size" | "ref"> & {
  size: InputSize;
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
    <div className={cn("input input--search", controlSizeClassName("input", size), className)}>
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
  ({ className, type, size = "md", variant = "default", value, onChange, ...props }, ref) => {
    if (variant === "search") {
      return (
        <SearchInput
          className={className}
          type={type}
          size={size}
          value={value}
          onChange={onChange}
          forwardedRef={ref}
          {...props}
        />
      );
    }

    return (
      <input
        type={type}
        className={cn("input", controlSizeClassName("input", size), className)}
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
