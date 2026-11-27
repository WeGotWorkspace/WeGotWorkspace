import type { CDPSession, Page } from "@playwright/test";

/** One node of Chromium's computed accessibility tree (what NVDA/JAWS/VoiceOver-in-Chrome read). */
export type AxNode = {
  nodeId: string;
  role: string;
  name: string;
  description: string;
  value: string;
  props: Record<string, unknown>;
  parentId?: string;
  childIds: string[];
  backendDOMNodeId?: number;
  ignored: boolean;
};

type RawAx = {
  nodeId: string;
  ignored: boolean;
  role?: { value?: string };
  name?: { value?: string };
  description?: { value?: string };
  value?: { value?: unknown };
  properties?: { name: string; value: { value?: unknown; relatedNodes?: { backendDOMNodeId: number; idref?: string }[] } }[];
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
};

export async function cdp(page: Page): Promise<CDPSession> {
  const s = await page.context().newCDPSession(page);
  await s.send("Accessibility.enable");
  return s;
}

export async function axTree(session: CDPSession): Promise<Map<string, AxNode>> {
  const { nodes } = (await session.send("Accessibility.getFullAXTree")) as { nodes: RawAx[] };
  const out = new Map<string, AxNode>();
  for (const n of nodes) {
    const props: Record<string, unknown> = {};
    for (const p of n.properties ?? []) props[p.name] = p.value.relatedNodes ? p.value.relatedNodes.map((r) => r.idref ?? r.backendDOMNodeId) : p.value.value;
    out.set(n.nodeId, {
      nodeId: n.nodeId,
      role: n.role?.value ?? "",
      name: String(n.name?.value ?? ""),
      description: String(n.description?.value ?? ""),
      value: n.value?.value === undefined ? "" : String(n.value.value),
      props,
      parentId: n.parentId,
      childIds: n.childIds ?? [],
      backendDOMNodeId: n.backendDOMNodeId,
      ignored: n.ignored,
    });
  }
  return out;
}

/** The node Chromium reports as focused, plus the active descendant it points at (if any). */
export async function focusInfo(session: CDPSession) {
  const tree = await axTree(session);
  const focused = [...tree.values()].filter((n) => n.props.focused === true && !n.ignored && n.role !== "RootWebArea").pop();
  let active: AxNode | undefined;
  const ad = focused?.props.activedescendant as (string | number)[] | undefined;
  if (ad?.length) {
    // CDP reports the relation by DOM id; map it to the AX node through its backend node id.
    const { result } = (await session.send("Runtime.evaluate", { expression: `document.getElementById(${JSON.stringify(String(ad[0]))})` })) as { result: { objectId?: string } };
    if (result.objectId) {
      const { node } = (await session.send("DOM.describeNode", { objectId: result.objectId })) as { node: { backendNodeId: number } };
      active = [...tree.values()].find((n) => n.backendDOMNodeId === node.backendNodeId);
    }
  }
  const ancestors = (n?: AxNode) => {
    const out: AxNode[] = [];
    let cur = n?.parentId ? tree.get(n.parentId) : undefined;
    while (cur) {
      out.push(cur);
      cur = cur.parentId ? tree.get(cur.parentId) : undefined;
    }
    return out;
  };
  return { tree, focused, active, ancestors };
}

export function brief(n?: AxNode): string {
  if (!n) return "(none)";
  const keep = ["rowindex", "colindex", "selected", "focusable", "focused", "editable", "multiselectable", "activedescendant", "readonly", "expanded", "autocomplete"];
  const p = keep.filter((k) => n.props[k] !== undefined).map((k) => `${k}=${JSON.stringify(n.props[k])}`);
  return `${n.role} "${n.name}"${n.description ? ` desc="${n.description}"` : ""}${n.value ? ` value="${n.value}"` : ""} ${p.join(" ")}`;
}
