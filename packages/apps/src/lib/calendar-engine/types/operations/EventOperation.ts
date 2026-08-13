import type {
  AddExceptionInput,
  AddExclusionInput,
  CreateInput,
  MoveInput,
  RemoveExceptionInput,
  RemoveExclusionInput,
  RemoveInput,
  ResizeEndInput,
  ResizeStartInput,
  UpdateInput,
} from "./inputs.js";

export type EventOperation =
  | { type: "create"; input: CreateInput }
  | { type: "update"; input: UpdateInput }
  | { type: "move"; input: MoveInput }
  | { type: "resize-start"; input: ResizeStartInput }
  | { type: "resize-end"; input: ResizeEndInput }
  | { type: "remove"; input: RemoveInput }
  | { type: "add-exclusion"; input: AddExclusionInput }
  | { type: "remove-exclusion"; input: RemoveExclusionInput }
  | { type: "add-exception"; input: AddExceptionInput }
  | { type: "remove-exception"; input: RemoveExceptionInput };
