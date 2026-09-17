<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Mail\JmapMailService;
use App\Services\Jmap\Methods\Concerns\ValidatesChangesArguments;

final class EmailChangesMethod implements JmapMethodInterface
{
    use ValidatesChangesArguments;

    public function __construct(private JmapMailService $mail) {}

    public function name(): string
    {
        return 'Email/changes';
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
        $this->sinceState($args);

        return $this->mail->emailChanges($username, $args);
    }
}
