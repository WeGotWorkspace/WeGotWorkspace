<?php

use App\Http\Support\WgwOversizedPost;
use Illuminate\Http\Request;

// Belt-and-suspenders after SAPI start. Line-0 post_max_size warnings still
// need display_errors=0 in .user.ini / .htaccess / uploads.ini (or `php -S -d`).
ini_set('display_errors', '0');
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
if (ob_get_level() === 0) {
    ob_start();
}

define('LARAVEL_START', microtime(true));

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require __DIR__.'/../vendor/autoload.php';

// Pre-Laravel only: PHP already discarded an oversized POST. Exit with JSON 413
// here so the kernel never starts. Content-Length only — chunked oversize is
// handled later (import / PostTooLargeException). Do not call this mid-cycle.
WgwOversizedPost::abortIfExceeded();

// Apache Alias "/api" sets SCRIPT_NAME to "/api/index.php", which makes Laravel treat "/api"
// as the app base and match routes on "v1/health" instead of "api/v1/health".
$scriptName = (string) ($_SERVER['SCRIPT_NAME'] ?? '');
if (str_starts_with($scriptName, '/api/')) {
    unset($_SERVER['PATH_INFO'], $_SERVER['ORIG_PATH_INFO']);
    $_SERVER['SCRIPT_NAME'] = '/index.php';
}

// Bootstrap Laravel and handle the request...
(require_once __DIR__.'/../bootstrap/app.php')
    ->handleRequest(Request::capture());
