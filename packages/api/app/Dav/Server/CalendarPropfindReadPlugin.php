<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\DAVACL\Plugin as AclPlugin;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

/**
 * PROPFIND under calendars/ requires {DAV:}read.
 *
 * Sabre otherwise answers HTTP 207 and marks each property 403, which looks like success.
 * Calendar homes stay resolvable for iTIP; this only rejects the listing.
 */
final class CalendarPropfindReadPlugin extends ServerPlugin
{
    private Server $server;

    public function initialize(Server $server): void
    {
        $this->server = $server;
        // Sabre emits beforeMethod in ascending priority. Auth runs at 10 and
        // sets the current principal; this check must run after that.
        $server->on('beforeMethod:*', [$this, 'beforeMethod'], 20);
    }

    public function beforeMethod(RequestInterface $request, ResponseInterface $response): void
    {
        if ($request->getMethod() !== 'PROPFIND') {
            return;
        }
        $path = trim($request->getPath(), '/');
        if (! str_starts_with($path, 'calendars/')) {
            return;
        }
        if (! $this->server->tree->nodeExists($path)) {
            return;
        }
        $acl = $this->server->getPlugin('acl');
        if (! $acl instanceof AclPlugin) {
            return;
        }
        $acl->checkPrivileges($path, '{DAV:}read');
    }
}
