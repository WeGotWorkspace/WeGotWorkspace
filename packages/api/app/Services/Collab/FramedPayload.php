<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Exceptions\ApiHttpException;

/**
 * [uint16 headerLen, big-endian][UTF-8 JSON header][tail]
 *
 * A collaboration save puts `documentLen` and `yjsLen` in the header and the
 * markdown bytes, then the Yjs bytes, in the tail. A null length omits that
 * block. `title` is an optional header string.
 */
final class FramedPayload
{
    public const INVALID_BODY_MESSAGE = 'Malformed collaboration request body.';

    /**
     * Markdown and Yjs blocks, plus `title` when the header carries one.
     *
     * @return array{markdown?: string, yjs?: string, title?: string}
     */
    public static function collaborationFields(string $body): array
    {
        $framed = self::decode($body);
        $documentLen = self::length($framed['header'], 'documentLen');
        $yjsLen = self::length($framed['header'], 'yjsLen');
        $tail = $framed['tail'];
        if (($documentLen ?? 0) + ($yjsLen ?? 0) !== strlen($tail)) {
            self::invalid();
        }

        $payload = [];
        $offset = 0;
        if ($documentLen !== null) {
            $payload['markdown'] = substr($tail, $offset, $documentLen);
            $offset += $documentLen;
        }
        if ($yjsLen !== null) {
            $payload['yjs'] = substr($tail, $offset, $yjsLen);
        }
        if (array_key_exists('title', $framed['header'])) {
            $title = $framed['header']['title'];
            if (! is_string($title)) {
                self::invalid();
            }
            $payload['title'] = $title;
        }

        return $payload;
    }

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

    /**
     * @param  array<string, mixed>  $header
     */
    private static function length(array $header, string $key): ?int
    {
        if (! array_key_exists($key, $header)) {
            self::invalid();
        }
        $value = $header[$key];
        if ($value === null) {
            return null;
        }
        if (! is_int($value) || $value < 0) {
            self::invalid();
        }

        return $value;
    }

    private static function invalid(): never
    {
        throw new ApiHttpException(400, self::INVALID_BODY_MESSAGE, 'invalid_body');
    }
}
