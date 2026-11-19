<?php

declare(strict_types=1);

return [
    'default' => env('FILESYSTEM_DISK', 'local'),

    'disks' => [
        // The wgw disks use `wgw_local`: the local driver with each operation timed
        // for the slow-request log (RequestTimingServiceProvider, #2244).
        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => false,
            'report' => false,
        ],

        'wgw_data' => [
            'driver' => 'wgw_local',
            'root' => storage_path('app/wgw-data'),
            'throw' => true,
        ],

        'wgw_files' => [
            'driver' => 'wgw_local',
            'root' => storage_path('app/wgw-files'),
            'throw' => true,
        ],

        'wgw_notes' => [
            'driver' => 'wgw_local',
            'root' => storage_path('app/wgw-files'),
            'throw' => true,
        ],
    ],

    'links' => [],
];
