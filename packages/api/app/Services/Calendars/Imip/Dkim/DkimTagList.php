<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip\Dkim;

/**
 * A DKIM tag=value list (RFC 6376 3.2), used by signatures and key records.
 * Tag names are case-sensitive; values keep their inner folding whitespace
 * and lose it at both ends. A duplicate tag or a piece without `=` makes
 * the whole list invalid. Tag order is kept.
 */
final class DkimTagList
{
    private const MAX_TAGS = 64;

    /**
     * @return array<string, string>|null
     */
    public static function parse(string $value): ?array
    {
        $pieces = explode(';', $value);
        if (count($pieces) > self::MAX_TAGS + 1) {
            return null;
        }
        $tags = [];
        $last = count($pieces) - 1;
        foreach ($pieces as $index => $piece) {
            if (trim($piece, " \t\r\n") === '') {
                if ($index === $last) {
                    break;
                }

                return null;
            }
            if (preg_match('/^[ \t\r\n]*([A-Za-z][A-Za-z0-9_]*)[ \t\r\n]*=(.*)$/s', $piece, $match) !== 1) {
                return null;
            }
            $name = $match[1];
            if (array_key_exists($name, $tags)) {
                return null;
            }
            $tags[$name] = trim($match[2], " \t\r\n");
        }

        return $tags;
    }

    /** A tag value with all folding whitespace removed (base64 and lists). */
    public static function compact(string $value): string
    {
        return (string) preg_replace('/[ \t\r\n]+/', '', $value);
    }

    /**
     * A colon-separated list (`h=`, `q=`, key `h=`, `s=`, `t=`), each item
     * trimmed and lower-cased; empty items dropped.
     *
     * @return list<string>
     */
    public static function list(string $value): array
    {
        $items = [];
        foreach (explode(':', $value) as $item) {
            $item = strtolower(trim($item, " \t\r\n"));
            if ($item !== '') {
                $items[] = $item;
            }
        }

        return $items;
    }
}
