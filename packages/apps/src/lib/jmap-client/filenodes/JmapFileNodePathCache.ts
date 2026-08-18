import type { JmapFileNode } from "./types.js";

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return "/";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, "");
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? normalized.replace(/^\//, "") : normalized.slice(idx + 1);
}

export type CachedFileNode = {
  path: string;
  node: JmapFileNode;
};

/**
 * Path ↔ FileNode id cache. Roots: personal home is `/users/{username}`;
 * other top-level nodes map to `/groups/{name}`.
 */
export class JmapFileNodePathCache {
  #pathToId = new Map<string, string>();
  #idToPath = new Map<string, string>();
  #nodes = new Map<string, JmapFileNode>();

  remember(path: string, node: JmapFileNode): void {
    const normalized = normalizePath(path);
    this.forgetId(node.id);
    this.#pathToId.set(normalized, node.id);
    this.#idToPath.set(node.id, normalized);
    this.#nodes.set(node.id, node);
  }

  rememberChildren(parentPath: string, nodes: JmapFileNode[]): CachedFileNode[] {
    const parent = normalizePath(parentPath);
    return nodes.map((node) => {
      const path = parent === "/" ? `/${node.name}` : `${parent}/${node.name}`;
      this.remember(path, node);
      return { path, node };
    });
  }

  rememberTopLevel(username: string, nodes: JmapFileNode[]): CachedFileNode[] {
    const homeName = username.trim();
    let homeAssigned = false;
    const remembered: CachedFileNode[] = [];
    for (const node of nodes) {
      const isHome = !homeAssigned && node.name === homeName;
      if (isHome) homeAssigned = true;
      const path = isHome ? `/users/${homeName}` : `/groups/${node.name}`;
      this.remember(path, node);
      remembered.push({ path, node });
    }
    return remembered;
  }

  nodeIdForPath(path: string): string | undefined {
    return this.#pathToId.get(normalizePath(path));
  }

  pathForNodeId(id: string): string | undefined {
    return this.#idToPath.get(id);
  }

  node(id: string): JmapFileNode | undefined {
    return this.#nodes.get(id);
  }

  nodeAtPath(path: string): JmapFileNode | undefined {
    const id = this.nodeIdForPath(path);
    return id ? this.#nodes.get(id) : undefined;
  }

  homePath(username: string): string {
    return normalizePath(`/users/${username?.trim() || ""}`);
  }

  forgetPath(path: string): void {
    const normalized = normalizePath(path);
    const id = this.#pathToId.get(normalized);
    this.#pathToId.delete(normalized);
    if (id) {
      this.#idToPath.delete(id);
      this.#nodes.delete(id);
    }
  }

  forgetSubtree(path: string): void {
    const prefix = `${normalizePath(path)}/`;
    const root = normalizePath(path);
    const paths = [...this.#pathToId.keys()].filter((p) => p === root || p.startsWith(prefix));
    for (const p of paths) this.forgetPath(p);
  }

  movePath(from: string, to: string): void {
    const fromNorm = normalizePath(from);
    const toNorm = normalizePath(to);
    if (fromNorm === toNorm) return;
    const subtree = [...this.#pathToId.entries()].filter(
      ([p]) => p === fromNorm || p.startsWith(`${fromNorm}/`),
    );
    for (const [oldPath, id] of subtree) {
      const node = this.#nodes.get(id);
      const suffix = oldPath === fromNorm ? "" : oldPath.slice(fromNorm.length);
      const nextPath = `${toNorm}${suffix}`;
      this.#pathToId.delete(oldPath);
      this.#pathToId.set(nextPath, id);
      this.#idToPath.set(id, nextPath);
      if (node && oldPath === fromNorm) {
        this.#nodes.set(id, { ...node, name: basename(nextPath) });
      }
    }
  }

  forgetId(id: string): void {
    const path = this.#idToPath.get(id);
    if (path) this.#pathToId.delete(path);
    this.#idToPath.delete(id);
    this.#nodes.delete(id);
  }

  clear(): void {
    this.#pathToId.clear();
    this.#idToPath.clear();
    this.#nodes.clear();
  }
}
