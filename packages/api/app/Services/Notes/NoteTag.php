<?php

declare(strict_types=1);

namespace App\Services\Notes;

/**
 * Note tags are a strict slug: letters a-z and hyphen.
 * Letters are lowercased. Any other character rejects the whole tag.
 */
final class NoteTag
{
    public const PATTERN = '/^[a-z-]+$/';

    /**
     * @return list<string>
     */
    public static function normalizeList(mixed $tags): array
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
            if (preg_match(self::PATTERN, $normalized) !== 1) {
                continue;
            }
            $out[$normalized] = true;
        }

        return array_keys($out);
    }
}
