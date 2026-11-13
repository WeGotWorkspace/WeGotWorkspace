<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * One mailbox from an address header. `fromHeader()` returns null unless the
 * header holds exactly one address, so a list or a group never counts.
 */
final readonly class MailAddress
{
    public function __construct(
        public string $email,
        public string $displayName,
    ) {}

    public function domain(): string
    {
        return strtolower(substr($this->email, (int) strrpos($this->email, '@') + 1));
    }

    public static function fromHeader(?string $value): ?self
    {
        if ($value === null || trim($value) === '' || strlen($value) > 2048) {
            return null;
        }
        $bare = self::withoutQuotedAndComments($value);
        if ($bare === null || str_contains($bare, ',') || str_contains($bare, ';')) {
            return null;
        }
        $displayName = '';
        if (preg_match('/<([^<>]*)>/', $bare, $match) === 1) {
            if (substr_count($bare, '<') !== 1) {
                return null;
            }
            $email = trim($match[1]);
            $namePart = trim((string) strstr($value, '<', true));
            $displayName = self::decodeDisplayName($namePart);
        } else {
            $email = trim($bare);
        }
        $email = strtolower($email);
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return null;
        }

        return new self($email, $displayName);
    }

    /** Drop quoted strings and comments so their commas and brackets do not count. */
    private static function withoutQuotedAndComments(string $value): ?string
    {
        $out = '';
        $depth = 0;
        $quoted = false;
        $length = strlen($value);
        for ($i = 0; $i < $length; $i++) {
            $char = $value[$i];
            if ($char === '\\' && ($quoted || $depth > 0)) {
                $i++;

                continue;
            }
            if ($quoted) {
                if ($char === '"') {
                    $quoted = false;
                }

                continue;
            }
            if ($char === '"' && $depth === 0) {
                $quoted = true;

                continue;
            }
            if ($char === '(') {
                $depth++;

                continue;
            }
            if ($char === ')') {
                if ($depth === 0) {
                    return null;
                }
                $depth--;

                continue;
            }
            if ($depth === 0) {
                $out .= $char;
            }
        }

        return ($quoted || $depth !== 0) ? null : $out;
    }

    private static function decodeDisplayName(string $name): string
    {
        $name = trim($name);
        if (str_starts_with($name, '"') && str_ends_with($name, '"') && strlen($name) >= 2) {
            $name = stripcslashes(substr($name, 1, -1));
        }
        $decoded = str_contains($name, '=?') ? @iconv_mime_decode($name, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8') : $name;
        $decoded = is_string($decoded) ? $decoded : '';

        return mb_substr(trim(preg_replace('/[\x00-\x1f\x7f]/u', '', $decoded) ?? ''), 0, 120);
    }
}
