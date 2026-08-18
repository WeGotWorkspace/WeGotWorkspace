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

export type EventOperationRequest =
  | { kind: "create"; input: CreateInput }
  | { kind: "update"; input: UpdateInput }
  | { kind: "move"; input: MoveInput }
  | { kind: "resizeStart"; input: ResizeStartInput }
  | { kind: "resizeEnd"; input: ResizeEndInput }
  | { kind: "remove"; input: RemoveInput }
  | { kind: "addExclusion"; input: AddExclusionInput }
  | { kind: "removeExclusion"; input: RemoveExclusionInput }
  | { kind: "addException"; input: AddExceptionInput }
  | { kind: "removeException"; input: RemoveExceptionInput };
