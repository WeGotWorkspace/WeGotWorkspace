<?php

declare(strict_types=1);

namespace App\Http\RateLimiting;

use App\Services\Meet\MeetActorResolver;
use App\Services\Meet\MeetRequestAuth;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Per-actor throttles for the room routes.
 *
 * A guest is an actor only with a server-signed session key. Anything else —
 * including a self-minted 32-hex key — is anonymous and shares the address
 * budget. Signed actors are keyed per room, with an actor-wide ceiling and an
 * address ceiling so one office NAT still cannot multiply budgets by minting
 * sessions. Accounts (`u:`) are not subject to that address ceiling: an office
 * NAT of signed-in people must not share one 1,200/min bucket. Guests (`g:`)
 * keep it. Anonymous traffic returns only the 300/min address limit — a second
 * limit on the same `ip:` key is incremented too, and would halve the budget.
 */
final class RtcRoomRateLimiters
{
    public const ROOMS = 'rtc-rooms';

    public const ANONYMOUS_JOIN = 'rtc-anon-join';

    public const RELAY = 'rtc-relay';

    public const METRICS = 'rtc-metrics';

    /** 4 peers polling at 400 ms is 150 requests per minute, plus sends and leaves. */
    private const ROOM_REQUESTS_PER_MINUTE = 300;

    /** One account across every room and device, above the per-room ceiling. */
    private const ACTOR_REQUESTS_PER_MINUTE = 1500;

    /** Shared by every actor (and every forged key) behind one address. */
    private const ADDRESS_ROOM_REQUESTS_PER_MINUTE = 1200;

    private const ANONYMOUS_JOINS_PER_MINUTE = 60;

    private const RELAY_REQUESTS_PER_MINUTE = 6;

    private const ADDRESS_RELAY_REQUESTS_PER_MINUTE = 30;

    private const METRIC_REPORTS_PER_MINUTE = 30;

    public static function register(): void
    {
        RateLimiter::for(self::ROOMS, static function (Request $request): array {
            $address = self::addressKey($request);
            $actor = self::actorIdentity($request);
            if ($actor === null) {
                return [
                    Limit::perMinute(self::ROOM_REQUESTS_PER_MINUTE)->by($address),
                ];
            }

            $room = self::roomId($request);
            $perRoom = $room === '' ? $actor : $actor.'|'.$room;
            $limits = [
                Limit::perMinute(self::ROOM_REQUESTS_PER_MINUTE)->by($perRoom),
                Limit::perMinute(self::ACTOR_REQUESTS_PER_MINUTE)->by($actor),
            ];
            if (str_starts_with($actor, 'g:')) {
                $limits[] = Limit::perMinute(self::ADDRESS_ROOM_REQUESTS_PER_MINUTE)->by($address);
            }

            return $limits;
        });

        RateLimiter::for(self::ANONYMOUS_JOIN, static function (Request $request): Limit {
            return self::actorIdentity($request) === null
                ? Limit::perMinute(self::ANONYMOUS_JOINS_PER_MINUTE)->by(self::addressKey($request))
                : Limit::none();
        });

        RateLimiter::for(self::RELAY, static function (Request $request): array {
            $address = self::addressKey($request);
            $actor = self::actorIdentity($request);

            return [
                Limit::perMinute(self::RELAY_REQUESTS_PER_MINUTE)->by($actor ?? $address),
                Limit::perMinute(self::ADDRESS_RELAY_REQUESTS_PER_MINUTE)->by($address),
            ];
        });

        RateLimiter::for(self::METRICS, static function (Request $request): array {
            // A guest session key is only an actor when the server signed it.
            // The address ceiling still matches the per-actor ceiling so one
            // NAT cannot multiply inserts by collecting signed keys.
            $actor = self::actorIdentity($request);
            $address = self::addressKey($request);
            if ($actor === null) {
                return [Limit::perMinute(self::METRIC_REPORTS_PER_MINUTE)->by($address)];
            }

            return [
                Limit::perMinute(self::METRIC_REPORTS_PER_MINUTE)->by($actor),
                Limit::perMinute(self::METRIC_REPORTS_PER_MINUTE)->by($address),
            ];
        });
    }

    private static function addressKey(Request $request): string
    {
        return 'ip:'.(string) $request->ip();
    }

    private static function roomId(Request $request): string
    {
        $roomId = $request->route('roomId');

        return is_string($roomId) ? $roomId : '';
    }

    /** Username for an account, the signed guest session key for a guest, null when anonymous. */
    private static function actorIdentity(Request $request): ?string
    {
        $username = app(MeetRequestAuth::class)
            ->tryAuthenticatedUsername($request, (string) config('wgw.auth_realm', 'SabreDAV'));
        if ($username !== null) {
            return 'u:'.$username;
        }

        $sessionKey = app(MeetActorResolver::class)->readGuestSessionKey([
            'sessionKey' => $request->input('sessionKey'),
        ]);
        if ($sessionKey !== null) {
            return 'g:'.$sessionKey;
        }

        return null;
    }
}
