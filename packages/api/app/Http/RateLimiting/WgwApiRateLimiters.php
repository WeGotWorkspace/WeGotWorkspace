<?php

declare(strict_types=1);

namespace App\Http\RateLimiting;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Search\UnifiedSearchService;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Account budgets for authenticated API traffic.
 *
 * `wgw-api` is the shared bucket for ordinary routes, including MCP. 600/min is
 * an unmeasured starting budget, shared by every tab and device of one account.
 * `files/content` sits in that same bucket, so a folder of previews can spend it.
 *
 * `wgw-search` is not route middleware. {@see consumeSearch()} runs inside
 * {@see UnifiedSearchService} when the query has tokens, so
 * the SPA and MCP share one 60/min scan budget. Browse mode has no tokens and
 * stays on the account bucket. {@see SEARCH} is only the cache-key prefix.
 * `register()` does not install `throttle:wgw-search`; that middleware name
 * fails at runtime.
 *
 * `X-RateLimit-*` on a search response comes from the `wgw-api` middleware and
 * describes the account bucket. A scan-budget 429 carries `Retry-After` only.
 */
final class WgwApiRateLimiters
{
    public const API = 'wgw-api';

    public const SEARCH = 'wgw-search';

    private const API_REQUESTS_PER_MINUTE = 600;

    /** Type-ahead with debounce stays under this. Each call scans document text. */
    private const SEARCH_REQUESTS_PER_MINUTE = 60;

    /** Decay passed to {@see RateLimiter::hit()}. Separate from the attempt count. */
    private const SEARCH_WINDOW_SECONDS = 60;

    public static function register(): void
    {
        RateLimiter::for(self::API, static fn (Request $request): Limit => self::limit(
            $request,
            self::API_REQUESTS_PER_MINUTE,
        ));
    }

    /**
     * One scan budget for every caller of unified search, including MCP tools.
     */
    public static function consumeSearch(string $username): void
    {
        $key = self::SEARCH.':user:'.$username;
        if (RateLimiter::tooManyAttempts($key, self::SEARCH_REQUESTS_PER_MINUTE)) {
            throw new ApiHttpException(
                429,
                'Too many requests.',
                'rate_limited',
                [],
                ['Retry-After' => max(1, RateLimiter::availableIn($key))],
            );
        }

        RateLimiter::hit($key, self::SEARCH_WINDOW_SECONDS);
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

    /**
     * A custom `AUTH_MODEL` still gets its own key. Username wins; otherwise the
     * auth identifier, so an office NAT does not collapse into one `ip:` bucket.
     */
    private static function passportUsername(Request $request): ?string
    {
        $user = $request->user();
        if (! $user instanceof Authenticatable) {
            return null;
        }

        $username = self::stringAttribute($user, 'username');
        if ($username !== null) {
            return $username;
        }

        return self::authIdentifier($user);
    }

    /**
     * Variable property access on purpose: `AUTH_MODEL` may not be the default
     * user model, and a magic attribute bag only answers `isset`.
     */
    private static function stringAttribute(Authenticatable $user, string $name): ?string
    {
        if (! isset($user->{$name})) {
            return null;
        }
        $value = $user->{$name};
        if (! is_string($value) || $value === '') {
            return null;
        }

        return $value;
    }

    private static function authIdentifier(Authenticatable $user): ?string
    {
        $id = $user->getAuthIdentifier();
        if (is_string($id) && $id !== '') {
            return $id;
        }
        if (is_int($id)) {
            return (string) $id;
        }

        return null;
    }
}
