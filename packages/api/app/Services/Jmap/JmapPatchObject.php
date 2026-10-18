<?php

declare(strict_types=1);

namespace App\Services\Jmap;

use App\Exceptions\ApiHttpException;

/**
 * Applies an RFC 8620 §5.3 PatchObject to a JMAP object.
 *
 * - A top-level key replaces the whole property (`null` removes it).
 * - A key with `/` is a JSON Pointer (RFC 6901, `~0`/`~1` escapes) into the
 *   object; it sets or (with `null`) removes that nested value. A pointer whose
 *   parent does not exist or is not an object is an `invalidPatch` error.
 * - Compatibility: a map value that contains `null` entries is applied as a
 *   partial update of that map (RFC 7396 merge-patch style) instead of a
 *   replacement. A client sending the whole map never includes `null`s.
 */
final class JmapPatchObject
{
    /**
     * @param  array<string, mixed>  $object
     * @param  array<string, mixed>  $patch
     * @param  list<string>  $ignored  Top-level keys the patch may not change.
     * @return array<string, mixed>
     */
    public static function apply(array $object, array $patch, array $ignored = ['id', '@type']): array
    {
        foreach ($patch as $key => $value) {
            $key = (string) $key;
            if (in_array($key, $ignored, true)) {
                continue;
            }

            if (str_contains($key, '/')) {
                $object = self::applyPointer($object, $key, $value);

                continue;
            }

            if ($value === null) {
                unset($object[$key]);

                continue;
            }

            if (is_array($value) && self::isPartialMap($value) && is_array($object[$key] ?? null)) {
                $map = $object[$key];
                foreach ($value as $entryKey => $entry) {
                    if ($entry === null) {
                        unset($map[$entryKey]);
                    } else {
                        $map[$entryKey] = $entry;
                    }
                }
                $object[$key] = $map;

                continue;
            }

            $object[$key] = $value;
        }

        return $object;
    }

    /**
     * @param  array<string, mixed>  $object
     * @return array<string, mixed>
     */
    private static function applyPointer(array $object, string $pointer, mixed $value): array
    {
        $segments = array_map(
            static fn (string $segment): string => str_replace(['~1', '~0'], ['/', '~'], $segment),
            explode('/', ltrim($pointer, '/')),
        );
        if (in_array('', $segments, true)) {
            throw new ApiHttpException(400, 'Invalid patch path: '.$pointer, 'invalidPatch');
        }

        $last = array_pop($segments);
        $node = &$object;
        foreach ($segments as $segment) {
            if (! isset($node[$segment]) || ! is_array($node[$segment])) {
                throw new ApiHttpException(400, 'Invalid patch path: '.$pointer, 'invalidPatch');
            }
            $node = &$node[$segment];
        }

        if ($value === null) {
            unset($node[$last]);
        } else {
            $node[$last] = $value;
        }
        unset($node);

        return $object;
    }

    /**
     * @param  array<mixed>  $value
     */
    private static function isPartialMap(array $value): bool
    {
        if ($value === [] || array_is_list($value)) {
            return false;
        }

        return in_array(null, $value, true);
    }
}
