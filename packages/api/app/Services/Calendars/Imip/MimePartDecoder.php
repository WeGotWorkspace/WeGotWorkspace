<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * Content-Transfer-Encoding and charset of one fetched part, to UTF-8 text.
 * Returns null when the bytes cannot be decoded.
 */
final class MimePartDecoder
{
    public static function decode(string $raw, string $encoding, string $charset): ?string
    {
        $bytes = match (strtolower(trim($encoding))) {
            'base64' => base64_decode(preg_replace('/[^A-Za-z0-9+\/=]/', '', $raw) ?? '', true),
            'quoted-printable' => quoted_printable_decode($raw),
            '7bit', '8bit', 'binary', '' => $raw,
            default => false,
        };
        if (! is_string($bytes)) {
            return null;
        }
        $charset = strtolower(trim($charset, " \t\"'"));
        if ($charset === '' || $charset === 'utf-8' || $charset === 'utf8' || $charset === 'us-ascii') {
            return mb_check_encoding($bytes, 'UTF-8') ? $bytes : null;
        }
        if (! in_array(strtoupper($charset), array_map('strtoupper', mb_list_encodings()), true)) {
            return null;
        }
        $converted = @mb_convert_encoding($bytes, 'UTF-8', $charset);

        return is_string($converted) && mb_check_encoding($converted, 'UTF-8') ? $converted : null;
    }
}
