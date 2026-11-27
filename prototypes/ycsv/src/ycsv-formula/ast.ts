export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "ref"; col: string; row: string; sheet?: string }
  | { k: "name"; path: string; sheet?: string }
  | { k: "range"; col: string; from: string; to: string; col2?: string; sheet?: string }
  | { k: "call"; fn: string; args: Node[] }
  | { k: "unary"; op: "-"; arg: Node }
  | { k: "bin"; op: string; l: Node; r: Node };
