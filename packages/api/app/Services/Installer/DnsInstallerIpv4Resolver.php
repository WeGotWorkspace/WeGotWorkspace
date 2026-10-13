<?php

declare(strict_types=1);

namespace App\Services\Installer;

final class DnsInstallerIpv4Resolver implements InstallerIpv4Resolver
{
    public function lookup(string $host): array
    {
        $records = gethostbynamel($host);
        if (! is_array($records)) {
            return [];
        }

        $ips = [];
        foreach ($records as $record) {
            if ($record !== '') {
                $ips[] = $record;
            }
        }

        return $ips;
    }
}
