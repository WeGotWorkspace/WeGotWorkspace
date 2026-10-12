<?php

declare(strict_types=1);

namespace App\Support\Net;

final class PublicIp
{
    public static function isPublic(string $ip): bool
    {
        $ip = trim($ip, '[]');
        if (preg_match('/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/i', $ip, $m) === 1) {
            $ip = $m[1];
        } elseif (preg_match('/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i', $ip, $m) === 1) {
            $n = (hexdec($m[1]) << 16) | hexdec($m[2]);
            $ip = long2ip($n);
        }

        return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE | FILTER_FLAG_GLOBAL_RANGE) !== false;
    }
}
