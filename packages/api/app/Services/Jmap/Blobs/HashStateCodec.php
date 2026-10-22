<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

/**
 * Stores a running sha256 between requests as a serialized HashContext
 * (documented __serialize()/__unserialize(); about 300 bytes).
 *
 * The serialized form is undocumented internal state with no stability
 * guarantee, and `wgw upgrade` can run between two steps, so every state
 * carries the build that wrote it and is only read back by that build.
 * Reading never throws: a corrupt, tampered, foreign, or non-HashContext
 * value is `null`, and the caller rebuilds the hash by streaming the bytes
 * in budgeted steps.
 */
final class HashStateCodec
{
    /**
     * @return array{state: string, build: string}
     */
    public static function encode(\HashContext $context): array
    {
        return ['state' => base64_encode(serialize($context)), 'build' => self::build()];
    }

    public static function decode(?string $state, ?string $build): ?\HashContext
    {
        if ($state === null || $state === '' || $build !== self::build()) {
            return null;
        }
        $raw = base64_decode($state, true);
        if ($raw === false || $raw === '') {
            return null;
        }

        // A corrupt value makes unserialize() return false with a warning
        // (it does not throw); keep the warning out of the response.
        set_error_handler(static fn (): bool => true);
        try {
            $value = unserialize($raw, ['allowed_classes' => [\HashContext::class]]);
        } catch (\Throwable) {
            $value = false;
        } finally {
            restore_error_handler();
        }

        return $value instanceof \HashContext ? $value : null;
    }

    /**
     * PHP version and architecture of the running build.
     */
    public static function build(): string
    {
        return PHP_VERSION.'|'.php_uname('m').'|'.PHP_INT_SIZE;
    }
}
