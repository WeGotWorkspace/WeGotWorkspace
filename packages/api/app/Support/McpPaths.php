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
}
