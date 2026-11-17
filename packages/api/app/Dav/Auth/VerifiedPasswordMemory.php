<?php

declare(strict_types=1);

namespace App\Dav\Auth;

use Illuminate\Contracts\Cache\Repository;
use Illuminate\Support\Facades\Cache;

/**
 * Where a verified DAV Basic password is remembered: APCu process memory only, so nothing
 * derived from a password goes to disk, the database or a shared cache. Tests bind a subclass.
 */
class VerifiedPasswordMemory
{
    public function store(): ?Repository
    {
        if ((string) config('app.key') === '' || ! extension_loaded('apcu') || ! apcu_enabled()) {
            return null;
        }

        return Cache::store('apc');
    }
}
