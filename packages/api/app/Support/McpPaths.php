<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Http\Request;

/**
 * The MCP transport and its OAuth surface. External MCP clients reach these
 * paths from other origins, so they keep open CORS and no opener isolation.
 */
final class McpPaths
{
    public static function matches(Request $request): bool
    {
        return $request->is('mcp')
            || $request->is('mcp/*')
            || $request->is('oauth')
            || $request->is('oauth/*')
            || $request->is('.well-known/oauth-authorization-server')
            || $request->is('.well-known/oauth-authorization-server/*')
            || $request->is('.well-known/oauth-protected-resource')
            || $request->is('.well-known/oauth-protected-resource/*');
    }

    /**
     * The SPA sign-in step of an MCP OAuth connect: `/login?return=/oauth/authorize…`.
     * A popup client must keep its opener through it, so it gets no COOP.
     */
    public static function isOauthLogin(Request $request): bool
    {
        if (! $request->is('login')) {
            return false;
        }
        $return = $request->query('return');

        return is_string($return)
            && ($return === '/oauth/authorize' || str_starts_with($return, '/oauth/authorize?'));
    }
}
