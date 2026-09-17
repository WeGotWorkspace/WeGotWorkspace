<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Mail\JmapMailService;
use App\Services\Jmap\Methods\Concerns\ValidatesSetArguments;

final class MailboxSetMethod implements JmapMethodInterface
{
    use ValidatesSetArguments;

    public function __construct(private JmapMailService $mail) {}

    public function name(): string
    {
        return 'Mailbox/set';
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
        $this->setOperations($args);

        return $this->mail->mailboxSet($username, $args);
    }
}
