<?php

declare(strict_types=1);

namespace App\Services\Jmap\Guest;

use App\Exceptions\ApiHttpException;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Octets the guests of one share may send per 24 hours (#1715), kept in
 * shared cache so every PHP-FPM worker counts the same total. A part is
 * charged by its Content-Length before the body is read; PHP never reads
 * past that length, so the charge is an upper bound of what is stored.
 * The charge comes first and the check second: two parts at once can only
 * fail closed, never both slip under the budget.
 */
final class GuestUploadBudget
{
    private const WINDOW_SECONDS = 86_400;

    public function charge(GuestUploadAccount $account, int $bytes): void
    {
        $budget = self::bytesPerDay();
        if ($budget <= 0) {
            return;
        }
        $key = self::key($account->shareId);
        $spent = RateLimiter::increment($key, self::WINDOW_SECONDS, max(0, $bytes));
        if ($spent > $budget) {
            throw new ApiHttpException(
                429,
                'This share link has received as much as it may today. Try again later.',
                'guest_upload_budget',
                [],
                ['Retry-After' => max(1, RateLimiter::availableIn($key))],
            );
        }
    }

    public static function bytesPerDay(): int
    {
        return (int) config('wgw.jmap.guest_upload_bytes_per_day', 0);
    }

    public static function key(string $shareId): string
    {
        return 'guest-upload-bytes:share:'.$shareId;
    }
}
