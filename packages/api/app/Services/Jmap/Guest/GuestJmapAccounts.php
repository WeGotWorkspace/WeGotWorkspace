<?php

declare(strict_types=1);

namespace App\Services\Jmap\Guest;

/**
 * Request-scoped registry of the guest upload account the gate opened for
 * this request (#1715). FileNodeAccountSupport reads it first, so a guest
 * account is only ever known through the gate, never from the shape of a name.
 */
final class GuestJmapAccounts
{
    /** @var array<string, GuestUploadAccount> */
    private array $accounts = [];

    public function register(GuestUploadAccount $account): void
    {
        $this->accounts[$account->accountId] = $account;
    }

    public function find(string $accountId): ?GuestUploadAccount
    {
        return $this->accounts[$accountId] ?? null;
    }

    public function forget(): void
    {
        $this->accounts = [];
    }
}
