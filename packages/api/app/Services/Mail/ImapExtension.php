<?php

declare(strict_types=1);

namespace App\Services\Mail;

/**
 * Availability check for PHP's optional ext-imap (absent on many shared
 * hosts). The Mail app degrades to 503 `imap_extension_required` without it;
 * nothing else in the API needs the extension. The override exists so tests
 * can pin that degradation path — `extension_loaded()` itself cannot be faked.
 */
final class ImapExtension
{
    private static ?bool $loadedOverride = null;

    public static function loaded(): bool
    {
        return self::$loadedOverride ?? extension_loaded('imap');
    }

    /**
     * Test-only: force the availability answer; null restores the real check.
     */
    public static function fakeLoaded(?bool $loaded): void
    {
        self::$loadedOverride = $loaded;
    }
}
