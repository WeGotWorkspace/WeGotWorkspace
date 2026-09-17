<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Mail\JmapMailService;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

final class MailboxGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(private JmapMailService $mail) {}

    public function name(): string
    {
        return 'Mailbox/get';
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
        $result = $this->mail->mailboxGet($username, $args);
        $result['list'] = $this->projectProperties($result['list'], $args);

        return $result;
    }
}
