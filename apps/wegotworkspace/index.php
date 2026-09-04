<?php

declare(strict_types=1);

/**
 * WeGotWorkspace front controller — all HTTP enters the Laravel app in packages/api.
 */

ini_set('display_errors', '0');
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
if (ob_get_level() === 0) {
    ob_start();
}

require __DIR__.'/bootstrap/WgwAppBootstrap.php';

WgwAppBootstrap::run(__DIR__);
