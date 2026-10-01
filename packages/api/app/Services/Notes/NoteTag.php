<?php

declare(strict_types=1);

namespace App\Services\Notes;

/**
 * New note tags are letters a-z and hyphen, stored lowercase.
 * Tags already on a note are kept so an edit does not delete them.
 */
final class NoteTag
{
    public const PATTERN = '/^[a-z-]+$/';

    /** Create/patch input: optional surrounding space, either case. */
    public const INPUT_PATTERN = '/^\s*[A-Za-z-]+\s*$/';

    public static function isValid(string $tag): bool
    {
        return preg_match(self::PATTERN, $tag) === 1;
    }

    /**
     * Trim, lowercase, and dedupe. Does not apply the character set.
     *
     * @return list<string>
     */
    public static function normalizeStored(mixed $tags): array
    {
        if (! is_array($tags)) {
            return [];
        }

        $out = [];
        foreach ($tags as $tag) {
            if (! is_string($tag)) {
                continue;
            }
            $normalized = strtolower(trim(str_replace(["\r", "\n"], ' ', $tag)));
            if ($normalized === '') {
                continue;
            }
            $out[$normalized] = true;
        }

        return array_keys($out);
    }

    /**
     * New writes: only tags that match {@see PATTERN}.
     *
     * @return list<string>
     */
    public static function normalizeList(mixed $tags): array
    {
        $out = [];
        foreach (self::normalizeStored($tags) as $tag) {
            if (self::isValid($tag)) {
                $out[] = $tag;
            }
        }

        return $out;
    }

    /**
     * Update set: a valid new tag, or a tag already stored on the note.
     *
     * @param  list<string>  $existing
     * @return list<string>
     */
    public static function mergeForUpdate(mixed $submitted, array $existing): array
    {
        $stored = array_fill_keys(self::normalizeStored($existing), true);
        $out = [];
        foreach (self::normalizeStored($submitted) as $tag) {
            if (self::isValid($tag) || isset($stored[$tag])) {
                $out[$tag] = true;
            }
        }

        return array_keys($out);
    }
}
