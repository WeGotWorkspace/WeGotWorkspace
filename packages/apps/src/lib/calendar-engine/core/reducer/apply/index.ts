import type { ApplyResult, EventOperation } from "../../../types/operations.js";
import type { ReduceContext } from "../reduceContext.js";
import { applyCreate } from "./create.js";
import { applyAddExclusion, applyRemoveExclusion } from "./exclusions.js";
import { applyAddException, applyRemoveException } from "./exceptions.js";
import { applyMove } from "./move.js";
import { applyRemove } from "./remove.js";
import { applyResizeEnd, applyResizeStart } from "./resize.js";
import { applyUpdate } from "./update.js";

export function applyOperation(operation: EventOperation, context: ReduceContext): ApplyResult {
  if (operation.type === "create") return applyCreate(operation.input, context);
  if (operation.type === "update") return applyUpdate(operation.input, context);
  if (operation.type === "move") return applyMove(operation.input, context);
  if (operation.type === "resize-start") return applyResizeStart(operation.input, context);
  if (operation.type === "resize-end") return applyResizeEnd(operation.input, context);
  if (operation.type === "remove") return applyRemove(operation.input, context);
  if (operation.type === "add-exclusion") return applyAddExclusion(operation.input, context);
  if (operation.type === "remove-exclusion") return applyRemoveExclusion(operation.input, context);
  if (operation.type === "add-exception") return applyAddException(operation.input, context);
  return applyRemoveException(operation.input, context);
}
