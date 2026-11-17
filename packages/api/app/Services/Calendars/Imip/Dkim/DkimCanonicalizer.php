<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip\Dkim;

/**
 * Header and body canonicalization (RFC 6376 3.4). Input uses CRLF line
 * ends; header fields are raw (folding and final CRLF kept).
 */
final class DkimCanonicalizer
{
    public const SIMPLE = 'simple';

    public const RELAXED = 'relaxed';

    public static function header(string $raw, string $mode): string
    {
        if ($mode === self::SIMPLE) {
            return $raw;
        }
        $colon = (int) strpos($raw, ':');
        $name = strtolower(rtrim(substr($raw, 0, $colon), " \t"));
        $value = str_replace("\r\n", '', substr($raw, $colon + 1));
        $value = trim((string) preg_replace('/[ \t]+/', ' ', $value), ' ');

        return $name.':'.$value."\r\n";
    }

    public static function body(string $body, string $mode): string
    {
        if ($mode === self::SIMPLE) {
            return (string) preg_replace('/(?:\r\n)+$/', '', $body)."\r\n";
        }
        $body = (string) preg_replace('/[ \t]+/', ' ', $body);
        $body = (string) preg_replace('/ (?=\r\n|$)/', '', $body);
        $body = (string) preg_replace('/(?:\r\n)+$/', '', $body);

        return $body === '' ? '' : $body."\r\n";
    }
}
