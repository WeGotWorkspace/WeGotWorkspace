<?php

declare(strict_types=1);

namespace App\Dav\Auth;

use Sabre\DAV\Exception;
use Sabre\DAV\Server;

final class TooManyAttempts extends Exception
{
    public function __construct(private readonly int $retryAfter)
    {
        parent::__construct('Too many login attempts.');
    }

    public function getHTTPCode(): int
    {
        return 429;
    }

    /**
     * @return array<string, string>
     */
    public function getHTTPHeaders(Server $server): array
    {
        return [
            'Retry-After' => sprintf('%d', max(1, $this->retryAfter)),
        ];
    }
}
