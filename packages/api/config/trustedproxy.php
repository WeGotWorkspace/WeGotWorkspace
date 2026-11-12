<?php

declare(strict_types=1);

// Read by Laravel's TrustProxies middleware: comma-separated addresses or CIDR ranges, or `*` for the connecting address.
return [
    'proxies' => env('WGW_TRUSTED_PROXIES', '127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'),
];
