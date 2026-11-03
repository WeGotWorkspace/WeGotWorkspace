<?php

declare(strict_types=1);

namespace App\Services\Jmap\Push;

/**
 * The event-source `id` (RFC 8620 §7.3): `v1;Note=<h>;FileNode=<h>;…`.
 *
 * A plain list of independent per-type hashes, never one hash over the whole,
 * so a client can rebuild an id from the per-type hashes it has confirmed.
 * Each hash is 128 bits (32 lower-case hex). The client only copies hashes
 * from ids the server sent; it never computes one.
 */
final class JmapPushEventId
{
    public const VERSION = 'v1';

    /** `Last-Event-ID` longer than this is malformed: 12 types are ~550 bytes. */
    public const MAX_LENGTH = 2048;

    private const HASH_PATTERN = '/^[0-9a-f]{32}$/';

    private const TYPE_PATTERN = '/^[A-Za-z]{1,64}$/';

    /**
     * 128-bit hash of a type's state for the user.
     */
    public static function hash(string $type, string $state): string
    {
        return substr(hash('sha256', $type."\n".$state), 0, 32);
    }

    /**
     * @param  array<string, string>  $hashesByType  in the order to emit
     */
    public static function encode(array $hashesByType): string
    {
        $parts = [self::VERSION];
        foreach ($hashesByType as $type => $hash) {
            $parts[] = $type.'='.$hash;
        }

        return implode(';', $parts);
    }

    /**
     * Per-type hashes from a `Last-Event-ID`, or null when the id is missing
     * or malformed (the caller then sends every requested type). Unknown type
     * names in a well-formed id are kept; the caller only looks up the types
     * it serves.
     *
     * @return array<string, string>|null
     */
    public static function parse(?string $id): ?array
    {
        if ($id === null || $id === '' || strlen($id) > self::MAX_LENGTH) {
            return null;
        }
        $parts = explode(';', $id);
        if (array_shift($parts) !== self::VERSION) {
            return null;
        }
        $hashes = [];
        foreach ($parts as $part) {
            $pair = explode('=', $part, 2);
            if (count($pair) !== 2) {
                return null;
            }
            [$type, $hash] = $pair;
            if (preg_match(self::TYPE_PATTERN, $type) !== 1
                || preg_match(self::HASH_PATTERN, $hash) !== 1
                || array_key_exists($type, $hashes)) {
                return null;
            }
            $hashes[$type] = $hash;
        }

        return $hashes;
    }
}
