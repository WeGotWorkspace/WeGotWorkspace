type DomProps = {
  key?: string | number;
  children?: unknown;
  className?: string;
  style?: Record<string, string | number | undefined>;
  tabIndex?: number;
  type?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  ref?: unknown;
  onClick?: () => void;
  onBlur?: () => void;
  onChange?: (event: { target: { value: string; checked: boolean } }) => void;
  onKeyDown?: (event: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    preventDefault(): void;
  }) => void;
  onMouseDown?: (event: { target: EventTarget; preventDefault(): void }) => void;
};

declare namespace JSX {
  interface IntrinsicElements {
    div: DomProps;
    section: DomProps;
    header: DomProps;
    strong: DomProps;
    label: DomProps;
    input: DomProps;
    button: DomProps;
    table: DomProps;
    thead: DomProps;
    tbody: DomProps;
    tr: DomProps;
    th: DomProps;
    td: DomProps & { "data-row"?: string; "data-col"?: string };
    pre: DomProps;
    span: DomProps;
  }
}

declare module "react" {
  export function useState<S>(initial: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T): { current: T };

  export interface KeyboardEvent<T = Element> {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    preventDefault(): void;
  }

  export interface MouseEvent<T = Element> {
    target: EventTarget;
    preventDefault(): void;
  }

  export namespace JSX {
    interface IntrinsicElements {
      div: DomProps;
      section: DomProps;
      header: DomProps;
      strong: DomProps;
      label: DomProps;
      input: DomProps;
      button: DomProps;
      table: DomProps;
      thead: DomProps;
      tbody: DomProps;
      tr: DomProps;
      th: DomProps;
      td: DomProps & { "data-row"?: string; "data-col"?: string };
      pre: DomProps;
      span: DomProps;
    }
  }
}

declare module "react/jsx-runtime" {
  export const Fragment: unique symbol;
  export function jsx(type: unknown, props: unknown, key?: unknown): unknown;
  export function jsxs(type: unknown, props: unknown, key?: unknown): unknown;
  export namespace JSX {
    interface IntrinsicElements {
      div: DomProps;
      section: DomProps;
      header: DomProps;
      strong: DomProps;
      label: DomProps;
      input: DomProps;
      button: DomProps;
      table: DomProps;
      thead: DomProps;
      tbody: DomProps;
      tr: DomProps;
      th: DomProps;
      td: DomProps & { "data-row"?: string; "data-col"?: string };
      pre: DomProps;
      span: DomProps;
    }
  }
}
