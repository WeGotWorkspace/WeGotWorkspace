/**
 * Notes names for the shared tag rules in `lib/tags`. A note tag follows the
 * same rules as a file tag, so the logic lives in one place.
 */
export {
  TAG_MAX_LENGTH as NOTE_TAG_MAX_LENGTH,
  isValidNewTag,
  normalizeTag,
  tagDelta as noteTagDelta,
  tagToggle as noteTagToggle,
  tagsAfterAdd as noteTagsAfterAdd,
  tagsAfterToggle as noteTagsAfterToggle,
} from "@/lib/tags/tag-rules";
