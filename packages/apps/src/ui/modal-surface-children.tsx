import * as React from "react";
import { cn } from "@/lib/utils";

const HEADER_NAMES = new Set(["DialogHeader", "AlertDialogHeader"]);
const FOOTER_NAMES = new Set(["DialogFooter", "AlertDialogFooter"]);

export type UiModalSlot = "header" | "footer";

/** Marks Dialog/AlertDialog header and footer so the surface wrapper can slot them. */
export function markUiModalSlot<T extends object>(component: T, slot: UiModalSlot): T {
  Object.defineProperty(component, "__uiModalSlot", { value: slot });
  return component;
}

function slotOf(child: React.ReactNode): UiModalSlot | undefined {
  if (!React.isValidElement(child) || typeof child.type === "string") return undefined;
  const type = child.type as {
    __uiModalSlot?: UiModalSlot;
    displayName?: string;
    name?: string;
  };
  if (type.__uiModalSlot) return type.__uiModalSlot;
  const name = type.displayName || type.name;
  if (name && HEADER_NAMES.has(name)) return "header";
  if (name && FOOTER_NAMES.has(name)) return "footer";
  return undefined;
}

function isHeader(child: React.ReactNode): boolean {
  return slotOf(child) === "header";
}

function isFooter(child: React.ReactNode): boolean {
  return slotOf(child) === "footer";
}

function flattenChildren(children: React.ReactNode): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  for (const child of React.Children.toArray(children)) {
    if (React.isValidElement(child) && child.type === React.Fragment) {
      out.push(...flattenChildren((child.props as { children?: React.ReactNode }).children));
    } else {
      out.push(child);
    }
  }
  return out;
}

function wrapFormChild(
  form: React.ReactElement<{ className?: string; children?: React.ReactNode }>,
) {
  const formKids = flattenChildren(form.props.children);
  const formBody: React.ReactNode[] = [];
  const formFooters: React.ReactNode[] = [];
  for (const kid of formKids) {
    if (isFooter(kid)) formFooters.push(kid);
    else formBody.push(kid);
  }
  return React.cloneElement(form, {
    className: cn("ui-modal-form", form.props.className),
    children: (
      <>
        {formBody.length > 0 ? <div className="ui-modal-body">{formBody}</div> : null}
        {formFooters}
      </>
    ),
  });
}

/** Header / scroll body / footer slots for centered Dialog and AlertDialog. */
export function wrapModalSurfaceChildren(children: React.ReactNode): React.ReactNode {
  const headers: React.ReactNode[] = [];
  const rest: React.ReactNode[] = [];
  const footers: React.ReactNode[] = [];

  for (const child of flattenChildren(children)) {
    if (isHeader(child)) headers.push(child);
    else if (isFooter(child)) footers.push(child);
    else rest.push(child);
  }

  const onlyForm = rest.length === 1 && React.isValidElement(rest[0]) && rest[0].type === "form";

  let body: React.ReactNode = null;
  if (onlyForm) {
    body = wrapFormChild(
      rest[0] as React.ReactElement<{ className?: string; children?: React.ReactNode }>,
    );
  } else if (rest.length > 0) {
    body = <div className="ui-modal-body">{rest}</div>;
  }

  return (
    <>
      {headers}
      {body}
      {footers}
    </>
  );
}
