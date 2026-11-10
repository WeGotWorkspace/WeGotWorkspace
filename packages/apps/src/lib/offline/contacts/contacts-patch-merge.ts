import type { ContactCard, ContactCardPatch } from "@/lib/models/contacts-types";

/**
 * Generic, spec-faithful JSContact (RFC 9553) PatchObject merge for the offline
 * contacts layer.
 *
 * `ContactCardPatch` patches emitted by the editor (`editDraftToPatch`) follow
 * the *nested-sparse-with-null-delete* convention, mirroring how the API server
 * applies them (`ConversionSupport::deepMergeContactCardPatch`):
 *
 * - **Id-keyed maps** (`emails`, `phones`, `links`, `organizations`, `notes`,
 *   `members`, …) are sparse — only changed ids are present. An entry value of
 *   `null` means "remove this id".
 * - **Nested objects** (e.g. `name`, or a single map entry's `contexts`) merge
 *   recursively, so unmanaged sibling fields survive a partial patch.
 * - **Arrays** (e.g. `name.components`, an address's `components`) replace
 *   wholesale — that is exactly how the editor emits them.
 * - **Scalars** replace.
 *
 * The merge is driven by value shape rather than a hardcoded field whitelist, so
 * every JSContact property (including ones the current editor does not touch) is
 * handled uniformly and losslessly.
 */

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `null` in a sparse patch is a delete instruction for the *target view* but a
 * delete *instruction to carry forward* when coalescing two patches that have
 * not yet reached the server.
 */
type NullBehavior = "delete" | "keep";

function mergeObjects(base: JsonObject, patch: JsonObject, onNull: NullBehavior): JsonObject {
  const result: JsonObject = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      if (onNull === "delete") {
        delete result[key];
      } else {
        result[key] = null;
      }
      continue;
    }

    const current = result[key];
    if (isPlainObject(value) && isPlainObject(current)) {
      result[key] = mergeObjects(current, value, onNull);
      continue;
    }

    // Arrays and scalars replace wholesale; an object replacing a non-object
    // (or vice versa) also replaces.
    result[key] = value;
  }

  return result;
}

/**
 * Apply a sparse `ContactCardPatch` to a full card, producing the optimistic
 * cached view. `null` map entries are resolved by removing the key, matching
 * what the server will return after the patch syncs.
 */
export function applyContactPatch(card: ContactCard, patch: ContactCardPatch): ContactCard {
  return mergeObjects(card as JsonObject, patch as JsonObject, "delete") as ContactCard;
}

/**
 * Coalesce two sparse patches (`a` applied before `b`) into a single equivalent
 * patch for the outbox. Unlike {@link applyContactPatch}, `null` entries are
 * preserved so the queued payload still instructs the server to delete the id.
 */
export function coalesceContactPatches(a: ContactCardPatch, b: ContactCardPatch): ContactCardPatch {
  return mergeObjects(a as JsonObject, b as JsonObject, "keep") as ContactCardPatch;
}
