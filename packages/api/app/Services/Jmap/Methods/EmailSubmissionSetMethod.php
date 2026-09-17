<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Mail\JmapMailService;
use App\Services\Jmap\Methods\Concerns\ValidatesSetArguments;

final class EmailSubmissionSetMethod implements JmapMethodInterface
{
    use ValidatesSetArguments;

    public function __construct(private JmapMailService $mail) {}

    public function name(): string
    {
        return 'EmailSubmission/set';
    }

    public function capability(): string
    {
        return JmapCapabilities::SUBMISSION;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $this->setOperations($args);

        return $this->mail->emailSubmissionSet($username, $args);
    }
}
