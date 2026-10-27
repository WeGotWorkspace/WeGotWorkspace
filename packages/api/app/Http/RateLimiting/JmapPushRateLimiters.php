<?php

declare(strict_types=1);

namespace App\Http\RateLimiting;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Rtc\Signaling\RtcBrowserId;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Own bucket for the JMAP event source (#1660). It is not in `wgw-api`: a
 * browser reconnects about 20 times a minute, and that must not spend the
 * account budget of ordinary routes.
 *
 * The JWT carries no session id, so the per-browser key adds the browser id
 * the client already sends for presence (`X-WGW-Browser-Id`, validated by
 * {@see RtcBrowserId}). A missing or
 * malformed id shares one `none` bucket. The caller can mint browser ids, so
 * a per-account ceiling caps the total. Limits are checked in order and a
 * full per-browser bucket stops before the account bucket is counted.
 *
 * `wgw.auth` runs first (priority list in bootstrap/app.php), so the key is
 * never the client address.
 */
final class JmapPushRateLimiters
{
    public const PUSH = 'wgw-jmap-push';

    public const BROWSER_HEADER = 'X-WGW-Browser-Id';

    /** 20/min of regular reconnects at a 3 s retry, up to 30/min of check-now, plus margin. */
    public const BROWSER_REQUESTS_PER_MINUTE = 60;

    /** About five busy browsers of one account. */
    public const ACCOUNT_REQUESTS_PER_MINUTE = 300;

    public static function register(): void
    {
        RateLimiter::for(self::PUSH, static function (Request $request): array {
            $account = self::accountKey($request);

            return [
                Limit::perMinute(self::BROWSER_REQUESTS_PER_MINUTE)
                    ->by($account.'|browser:'.(self::browserId($request) ?? 'none')),
                Limit::perMinute(self::ACCOUNT_REQUESTS_PER_MINUTE)->by($account),
            ];
        });
    }

    /**
     * @return non-empty-string|null
     */
    public static function browserId(Request $request): ?string
    {
        return RtcBrowserId::read(['browserId' => $request->headers->get(self::BROWSER_HEADER)]);
    }

    private static function accountKey(Request $request): string
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $username = is_array($principal) ? ($principal['username'] ?? null) : null;
        if (is_string($username) && $username !== '') {
            return 'push:user:'.$username;
        }
        $ip = $request->ip();

        return 'push:ip:'.(is_string($ip) && $ip !== '' ? $ip : 'unknown');
    }
}
