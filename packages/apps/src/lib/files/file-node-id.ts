const FILE_NODE_ID_PATTERN = /^fn-[0-9a-f]{32}$/i;

/** A FileNode id (`fn-` + 32 hex), the stable Drive file id that survives rename and move. */
export function isFileNodeId(value: string): boolean {
  return FILE_NODE_ID_PATTERN.test(value.trim());
}
