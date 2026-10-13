<?php

declare(strict_types=1);

namespace App\Http\RateLimiting;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Models\User;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Account budgets for authenticated API traffic.
 *
 * `wgw-api` is the shared bucket for ordinary routes. `wgw-search` is tighter:
 * one search runs a leading-wildcard scan per token. 600/min is an unmeasured
 * starting budget, shared by every tab and device of one account. `files/content`
 * sits in that same bucket, so a folder of previews can spend it.
 */
final class WgwApiRateLimiters
{
    public const API = 'wgw-api';

    public const SEARCH = 'wgw-search';

    private const API_REQUESTS_PER_MINUTE = 600;

    /** Type-ahead with debounce stays under this. Each call scans document text. */
    private const SEARCH_REQUESTS_PER_MINUTE = 60;

    public static function register(): void
    {
        RateLimiter::for(self::API, static fn (Request $request): Limit => self::limit(
            $request,
            self::API_REQUESTS_PER_MINUTE,
        ));
        RateLimiter::for(self::SEARCH, static fn (Request $request): Limit => self::limit(
            $request,
            self::SEARCH_REQUESTS_PER_MINUTE,
        ));
    }

    private static function limit(Request $request, int $perMinute): Limit
    {
        return Limit::perMinute($perMinute)->by(self::key($request));
    }

    /**
     * The address key is the fallback when neither `wgw.auth` nor Passport has
     * a username. Authenticated API routes set the principal first. MCP sets
     * the Passport user and has no principal.
     */
    private static function key(Request $request): string
    {
        $username = self::principalUsername($request) ?? self::passportUsername($request);
        if ($username !== null) {
            return 'user:'.$username;
        }

        $ip = $request->ip();

        return 'ip:'.(is_string($ip) && $ip !== '' ? $ip : 'unknown');
    }

    private static function principalUsername(Request $request): ?string
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        if (! is_array($principal)) {
            return null;
        }
        $username = $principal['username'] ?? null;

        return is_string($username) && $username !== '' ? $username : null;
    }

    private static function passportUsername(Request $request): ?string
    {
        $user = $request->user();
        if (! $user instanceof User) {
            return null;
        }

        return $user->username !== '' ? $user->username : null;
    }
}
