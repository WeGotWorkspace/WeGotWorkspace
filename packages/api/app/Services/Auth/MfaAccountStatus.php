<?php

declare(strict_types=1);

namespace App\Services\Auth;

final class MfaAccountStatus
{
    public function __construct(
        private UserMfaService $mfa,
        private RecoveryCodeService $recoveryCodes,
    ) {}

    /**
     * @return array{enabled: bool, required: bool, recovery_codes_remaining: int, suggest: bool}
     */
    public function forUsername(string $username): array
    {
        $username = strtolower(trim($username));
        $row = $this->mfa->find($username);
        $enabled = $row !== null && $row->enabled_at !== null;
        $snoozed = $row?->suggest_snoozed_until !== null && $row->suggest_snoozed_until->isFuture();

        return [
            'enabled' => $enabled,
            'required' => false,
            'recovery_codes_remaining' => $enabled ? $this->recoveryCodes->remaining($username) : 0,
            'suggest' => ! $enabled && ! $snoozed,
        ];
    }
}
