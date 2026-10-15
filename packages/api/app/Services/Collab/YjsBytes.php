<?php

declare(strict_types=1);

namespace App\Services\Collab;

/**
 * JSON `number[]` Yjs body shared by Docs collaboration PUT and Notes PATCH.
 *
 * The cap is per request. It is the same 5 MiB Docs already enforces.
 */
final class YjsBytes
{
    public const MAX_BYTES = 5_242_880;

    public static function decode(mixed $yjs): string
    {
        if (! is_array($yjs)) {
            throw new YjsPayloadException('invalid_yjs', 400);
        }

        // Stop at the cap before the rest of a huge list is copied into a string.
        if (count($yjs) > self::MAX_BYTES) {
            throw new YjsPayloadException('yjs_too_large', 413);
        }

        $bytes = '';
        foreach ($yjs as $byte) {
            if (! is_int($byte) || $byte < 0 || $byte > 255) {
                throw new YjsPayloadException('invalid_yjs', 400);
            }
            $bytes .= chr($byte);
        }

        return $bytes;
    }
}
