<?php

use App\Providers\AppServiceProvider;
use App\Providers\RequestTimingServiceProvider;
use App\Providers\WgwServiceProvider;
use Illuminate\Database\MigrationServiceProvider;

return [
    // First, so the `wgw_local` disk driver exists before any provider opens a disk.
    RequestTimingServiceProvider::class,
    AppServiceProvider::class,
    WgwServiceProvider::class,
    MigrationServiceProvider::class,
];
