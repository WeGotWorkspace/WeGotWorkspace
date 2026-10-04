<?php

declare(strict_types=1);

namespace App\Http\RateLimiting;

use App\Services\Meet\MeetRequestAuth;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Per-actor throttles for the room routes.
 *
 * Keying on the actor rather than the address is the point: a whole office
 * behind one NAT address is a dozen separate actors, while a single peer that
 * polls four times a second stays well inside its own budget. Only a request
 * with no actor at all — an anonymous join — falls back to the address, and
 * gets a much smaller budget.
 */
final class RtcRoomRateLimiters
{
    public const ROOMS = 'rtc-rooms';

    public const ANONYMOUS_JOIN = 'rtc-anon-join';

    public const RELAY = 'rtc-relay';

    public const METRICS = 'rtc-metrics';

    /** 4 peers polling at 400 ms is 150 requests per minute, plus sends and leaves. */
    private const ROOM_REQUESTS_PER_MINUTE = 300;

    private const ANONYMOUS_JOINS_PER_MINUTE = 60;

    private const RELAY_REQUESTS_PER_MINUTE = 6;

    private const METRIC_REPORTS_PER_MINUTE = 30;

    public static function register(): void
    {
        RateLimiter::for(
            self::ROOMS,
            static fn (Request $request): Limit => Limit::perMinute(self::ROOM_REQUESTS_PER_MINUTE)
                ->by(self::throttleKey($request)),
        );

        RateLimiter::for(self::ANONYMOUS_JOIN, static function (Request $request): Limit {
            return self::actorIdentity($request) === null
                ? Limit::perMinute(self::ANONYMOUS_JOINS_PER_MINUTE)->by('ip:'.(string) $request->ip())
                : Limit::none();
        });

        RateLimiter::for(
            self::RELAY,
            static fn (Request $request): Limit => Limit::perMinute(self::RELAY_REQUESTS_PER_MINUTE)
                ->by(self::throttleKey($request)),
        );

        RateLimiter::for(self::METRICS, static function (Request $request): array {
            // A guest session key is caller-chosen. Keying only on it lets one
            // address mint a fresh budget per key. The address ceiling matches
            // the per-actor ceiling so that minting cannot multiply inserts.
            $actor = self::actorIdentity($request);
            $address = 'ip:'.(string) $request->ip();
            if ($actor === null) {
                return [Limit::perMinute(self::METRIC_REPORTS_PER_MINUTE)->by($address)];
            }

            return [
                Limit::perMinute(self::METRIC_REPORTS_PER_MINUTE)->by($actor),
                Limit::perMinute(self::METRIC_REPORTS_PER_MINUTE)->by($address),
            ];
        });
    }

    private static function throttleKey(Request $request): string
    {
        return self::actorIdentity($request) ?? 'ip:'.(string) $request->ip();
    }

    /** Username for an account, the guest session key for a guest, null when anonymous. */
    private static function actorIdentity(Request $request): ?string
    {
        $username = app(MeetRequestAuth::class)
            ->tryAuthenticatedUsername($request, (string) config('wgw.auth_realm', 'SabreDAV'));
        if ($username !== null) {
            return 'u:'.$username;
        }

        $sessionKey = $request->input('sessionKey', $request->query('sessionKey'));
        if (is_string($sessionKey) && preg_match('/^[a-f0-9]{32}$/', $sessionKey) === 1) {
            return 'g:'.$sessionKey;
        }

        return null;
    }
}
