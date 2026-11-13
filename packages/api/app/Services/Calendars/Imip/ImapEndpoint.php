<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * Where to connect: the checked address, and the host name the certificate
 * must match. `security` is `ssl` (implicit TLS) or `starttls`.
 */
final readonly class ImapEndpoint
{
    public const SECURITY_SSL = 'ssl';

    public const SECURITY_STARTTLS = 'starttls';

    public function __construct(
        public string $host,
        public string $connectIp,
        public int $port,
        public string $security,
        public bool $verifyCertificate = true,
    ) {}
}
