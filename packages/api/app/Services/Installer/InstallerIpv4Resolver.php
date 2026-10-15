<?php

declare(strict_types=1);

namespace App\Services\Installer;

interface InstallerIpv4Resolver
{
    /**
     * IPv4 addresses a hostname resolves to. An empty list means unresolved.
     *
     * @return list<string>
     */
    public function lookup(string $host): array;
}
