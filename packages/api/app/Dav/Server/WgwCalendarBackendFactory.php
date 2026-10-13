<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Illuminate\Support\Facades\DB;

/**
 * One fresh backend per call, matching the lifetime of the ad-hoc
 * `new CalPDO(DB::connection('wgw')->getPdo())` it replaces.
 */
final class WgwCalendarBackendFactory
{
    public function make(): WgwCalendarBackend
    {
        return new WgwCalendarBackend(DB::connection('wgw')->getPdo());
    }
}
