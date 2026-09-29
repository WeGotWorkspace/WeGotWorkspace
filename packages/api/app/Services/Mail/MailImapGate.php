<?php

declare(strict_types=1);

namespace App\Services\Mail;

/**
 * Shared IMAP readiness check for folder, message, and compose operations.
 */
final class MailImapGate
{
    public function __construct(
        private MailCredentialService $credentials,
    ) {}

    /**
     * @return array{displayName: string, emailAddress: string, imap: array, smtp: array}
     */
    public function requireImap(string $username): array
    {
        if (! ImapExtension::loaded()) {
            throw new MailResponseException(503, ['error' => 'imap_extension_required']);
        }
        $cred = MailUserRuntime::resolve($username, $this->credentials);
        if ($cred === null) {
            throw new MailResponseException(400, ['error' => 'not_configured']);
        }

        return $cred;
    }
}
