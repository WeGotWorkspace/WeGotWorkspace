<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\DAVACL\Plugin as AclPlugin;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

/**
 * A REPORT on calendar, address book or file data requires {DAV:}read on the
 * collection or resource it targets.
 *
 * Sabre's ACL plugin does not check REPORT. calendar-query, calendar-multiget,
 * sync-collection and expand-property list member hrefs and mark only the
 * properties 403, so a caller without read learned event names, counts and
 * dates. The free-busy-query REPORT only checks read-free-busy, which {DAV:}read
 * aggregates, so owners, sharees and delegates keep it.
 */
final class CollectionReportReadPlugin extends ServerPlugin
{
    private const DATA_TREES = ['calendars', 'addressbooks', 'files'];

    private Server $server;

    public function initialize(Server $server): void
    {
        $this->server = $server;
        // Auth runs at 10 and sets the current principal; this check must run after it.
        $server->on('beforeMethod:*', [$this, 'beforeMethod'], 20);
    }

    public function beforeMethod(RequestInterface $request, ResponseInterface $response): void
    {
        if ($request->getMethod() !== 'REPORT') {
            return;
        }
        $path = trim($request->getPath(), '/');
        // Principal REPORTs (principal-property-search, expand-property for
        // delegation) are how clients look up people. DAVACL and the Team
        // directory rules filter them per property; they list no user data.
        if (! in_array(explode('/', $path, 2)[0], self::DATA_TREES, true)) {
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
