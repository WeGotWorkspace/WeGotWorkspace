<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;

/**
 * The one place services get a CalDAV backend (#1639). Both are fresh per
 * call, matching the lifetime of the ad-hoc `new CalPDO(...)` they replace.
 */
final class WgwCalendarBackendFactory
{
    /** Collection lifecycle: kind bookkeeping, hidden kinds, appearance follow (#1822). */
    public function make(): WgwCalendarBackend
    {
        return new WgwCalendarBackend(DB::connection('wgw')->getPdo());
    }

    /**
     * Sabre's plain PDO backend, as the services used before #1639. It skips
     * WgwCalendarBackend's DAV-facing overrides (note UID guard, sharee
     * appearance follow), so moving a caller to make() is a behaviour change.
     */
    public function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}
