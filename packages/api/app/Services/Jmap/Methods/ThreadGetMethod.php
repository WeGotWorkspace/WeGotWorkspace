<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Mail\JmapMailService;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

final class ThreadGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(private JmapMailService $mail) {}

    public function name(): string
    {
        return 'Thread/get';
    }

    public function capability(): string
    {
        return JmapCapabilities::MAIL;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $this->requestedIds($args);

        return $this->mail->threadGet($username, $args);
    }
}
