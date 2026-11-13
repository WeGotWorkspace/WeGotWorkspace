<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

use App\Services\Calendars\HostIpResolver;
use App\Support\Net\PublicIp;

/**
 * Checks a user-chosen IMAP host before any socket opens: it must resolve,
 * and every address must be public unless the install allows private hosts
 * (`WGW_IMIP_ALLOW_PRIVATE_HOSTS`). The returned endpoint pins the checked IP.
 */
class ImipEndpointResolver
{
    public function __construct(private readonly HostIpResolver $resolver) {}

    public function resolve(string $host, int $port, string $security): ImapEndpoint
    {
        $host = $this->resolver->normalizeHost($host);
        if ($host === '' || $port < 1 || $port > 65535
            || ! in_array($security, [ImapEndpoint::SECURITY_SSL, ImapEndpoint::SECURITY_STARTTLS], true)) {
            throw new ImapException(ImapException::HOST_NOT_ALLOWED, 'The mail server address is not valid.');
        }
        $ips = $this->resolver->resolve($host);
        if ($ips === []) {
            throw new ImapException(ImapException::CONNECT_FAILED, 'The mail server name does not resolve.');
        }
        $allowPrivate = (bool) config('wgw.imip_allow_private_hosts', false);
        if (! $allowPrivate) {
            foreach ($ips as $ip) {
                if (! PublicIp::isPublic($ip)) {
                    throw new ImapException(ImapException::HOST_NOT_ALLOWED, 'This mail server address is not allowed.');
                }
            }
        }

        return new ImapEndpoint(
            host: $host,
            connectIp: $ips[0],
            port: $port,
            security: $security,
            verifyCertificate: ! $allowPrivate,
        );
    }
}
