<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Mail\JmapMailService;

final class EmailQueryMethod implements JmapMethodInterface
{
    public function __construct(private JmapMailService $mail) {}

    public function name(): string
    {
        return 'Email/query';
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
        if (isset($args['filter']) && $args['filter'] !== null && ! is_array($args['filter'])) {
            throw new JmapMethodException('invalidArguments', 'filter must be an object.');
        }

        return $this->mail->emailQuery($username, $args);
    }
}
