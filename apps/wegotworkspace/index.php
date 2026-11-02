<?php

declare(strict_types=1);

/**
 * WeGotWorkspace front controller — all HTTP enters the Laravel app in packages/api.
 */

ini_set('display_errors', '0');
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
// Hold early warnings back so a pre-Laravel 413 stays clean JSON. The buffer
// flushes itself every 64 KiB: without that bound a streamed download (a
// WebDAV GET, a Drive file) piles up here until it exhausts memory_limit on
// hosts that run with output_buffering=0, such as Docker and `php -S` (#1839).
if (ob_get_level() === 0) {
    ob_start(null, 64 * 1024);
}

require __DIR__.'/bootstrap/WgwAppBootstrap.php';

WgwAppBootstrap::run(__DIR__);
