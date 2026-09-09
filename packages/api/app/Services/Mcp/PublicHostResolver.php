<?php

declare(strict_types=1);

namespace App\Services\Mcp;

class PublicHostResolver
{
    /**
     * @return list<string>
     */
    public function resolve(string $host): array
    {
        $host = trim($host, '[]');
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return [$host];
        }

        $ips = [];
        $aRecords = @gethostbynamel($host);
        if (is_array($aRecords)) {
            foreach ($aRecords as $ip) {
                if (is_string($ip) && $ip !== '') {
                    $ips[] = $ip;
                }
            }
        }
        $aaaa = @dns_get_record($host, DNS_AAAA);
        if (is_array($aaaa)) {
            foreach ($aaaa as $row) {
                if (is_array($row) && isset($row['ipv6']) && is_string($row['ipv6']) && $row['ipv6'] !== '') {
                    $ips[] = $row['ipv6'];
                }
            }
        }

        return array_values(array_unique($ips));
    }
}
