<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\DAV\Auth\Plugin as AuthPlugin;
use Sabre\DAV\Server;

/** The signed-in DAV user of a request: who sends its scheduling messages. */
final class DavCurrentUsername
{
    public static function of(?Server $server): ?string
    {
        $auth = $server?->getPlugin('auth');
        $principal = $auth instanceof AuthPlugin ? $auth->getCurrentPrincipal() : null;
        if (! is_string($principal) || ! str_starts_with($principal, 'principals/')) {
            return null;
        }
        $username = substr($principal, strlen('principals/'));

        return $username === '' || str_contains($username, '/') ? null : $username;
    }
}
