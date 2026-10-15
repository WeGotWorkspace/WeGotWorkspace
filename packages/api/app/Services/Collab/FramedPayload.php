<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Exceptions\ApiHttpException;

/**
 * [uint16 headerLen, big-endian][UTF-8 JSON header][tail]
 *
 * The tail is returned whole. The caller knows how to split it.
 */
final class FramedPayload
{
    /**
     * @return array{header: array<string, mixed>, tail: string}
     */
    public static function decode(string $body): array
    {
        if (strlen($body) < 2) {
            self::invalid();
        }

        $unpacked = unpack('nlen', substr($body, 0, 2));
        $headerLen = is_array($unpacked) ? (int) ($unpacked['len'] ?? 0) : 0;
        if ($headerLen > strlen($body) - 2) {
            self::invalid();
        }

        $json = substr($body, 2, $headerLen);
        try {
            $decoded = json_decode($json, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            self::invalid();
        }
        if (! is_object($decoded)) {
            self::invalid();
        }

        /** @var array<string, mixed> $header */
        $header = get_object_vars($decoded);

        return [
            'header' => $header,
            'tail' => substr($body, 2 + $headerLen),
        ];
    }

    private static function invalid(): never
    {
        throw new ApiHttpException(400, 'invalid_body', 'invalid_body');
    }
}
