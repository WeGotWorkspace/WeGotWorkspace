export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "ref"; col: string; row: string }
  | { k: "name"; path: string }
  | { k: "range"; col: string; from: string; to: string }
  | { k: "call"; fn: string; args: Node[] }
  | { k: "unary"; op: "-"; arg: Node }
  | { k: "bin"; op: string; l: Node; r: Node };
