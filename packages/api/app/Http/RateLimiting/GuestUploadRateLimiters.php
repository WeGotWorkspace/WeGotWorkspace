<?php

declare(strict_types=1);

namespace App\Http\RateLimiting;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Models\DriveShareSession;
use App\Services\Jmap\Guest\GuestUploadGate;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Request budget for guest uploads (#1715), keyed on the share, not the
 * session: a guest can mint new sessions (10 per link per hour through the
 * share-session limiter), but not new shares. Every guest of one link shares
 * this bucket, on top of the per-session `wgw-api` bucket.
 *
 * `wgw.auth` runs first (priority list in bootstrap/app.php). A principal
 * that is not a live guest session gets its own `guest:none` bucket; the
 * gate refuses it right after.
 */
final class GuestUploadRateLimiters
{
    public const UPLOAD = 'wgw-guest-upload';

    /** About 25 MB parts at a few hundred Mbit/s, plus appends and lookups, for a few guests. */
    public const SHARE_REQUESTS_PER_MINUTE = 300;

    public static function register(): void
    {
        RateLimiter::for(self::UPLOAD, static fn (Request $request): Limit => Limit::perMinute(self::SHARE_REQUESTS_PER_MINUTE)
            ->by('guest-upload:'.self::shareKey($request)));
    }

    private static function shareKey(Request $request): string
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $sessionKey = is_array($principal) ? GuestUploadGate::sessionKey($principal) : null;
        if ($sessionKey === null) {
            return 'none';
        }
        $shareId = DriveShareSession::query()->where('session_key', $sessionKey)->value('share_id');

        return is_string($shareId) && $shareId !== '' ? 'share:'.$shareId : 'none';
    }
}
