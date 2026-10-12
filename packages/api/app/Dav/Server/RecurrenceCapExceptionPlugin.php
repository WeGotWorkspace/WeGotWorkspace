<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\DAV\Exception\InsufficientStorage;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\VObject\Recur\MaxInstancesExceededException;

/**
 * Turns an uncaught recurrence-cap failure into HTTP 507 with a DAV error body.
 */
final class RecurrenceCapExceptionPlugin extends ServerPlugin
{
    public function initialize(Server $server): void
    {
        $server->on('exception', [$this, 'onException']);
    }

    public function onException(\Throwable $exception): void
    {
        if (! $exception instanceof MaxInstancesExceededException) {
            return;
        }

        throw new InsufficientStorage('Recurrence expansion exceeded the instance cap.', 0, $exception);
    }
}
