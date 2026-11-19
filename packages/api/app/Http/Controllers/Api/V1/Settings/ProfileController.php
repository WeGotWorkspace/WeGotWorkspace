<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Settings;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\SettingsProfileRequest;
use App\Http\Resources\Api\V1\SettingsStateResource;
use App\Models\Principal;
use App\Services\Auth\CurrentPasswordCheck;
use App\Services\Auth\UserSessionRevoker;
use App\Services\Settings\SettingsStateService;
use App\Services\Settings\UserProfileService;
use Illuminate\Http\JsonResponse;

final class ProfileController
{
    public function __construct(
        private UserProfileService $profiles,
        private SettingsStateService $settings,
        private CurrentPasswordCheck $currentPassword,
        private UserSessionRevoker $sessions,
    ) {}

    public function __invoke(SettingsProfileRequest $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $validated = $request->validated();
        $username = $principal['username'];

        $current = Principal::forUsername($username);
        $currentEmail = $current?->email;
        if (array_key_exists('displayName', $validated)) {
            $displayName = trim((string) $validated['displayName']);
        } elseif ($current !== null) {
            $displayName = trim((string) $current->displayname);
        } else {
            $displayName = '';
        }
        $emailProvided = array_key_exists('email', $validated);
        $nextEmail = $emailProvided
            ? $this->normalizeEmail($validated['email'] ?? null)
            : $this->normalizeEmail($currentEmail);
        $password = $this->submittedPassword($validated);
        $emailChanged = $emailProvided && $this->emailsDiffer($currentEmail, $nextEmail);

        if ($password !== null || $emailChanged) {
            $this->assertCurrentPassword($request, $username);
        }

        $this->profiles->updateProfile($username, $displayName, $nextEmail);

        if ($password !== null) {
            $this->profiles->updatePassword($username, $password);
            $this->sessions->revokeAll($username);
        }

        return (new SettingsStateResource(
            $this->settings->forUsername($username)
        ))->response();
    }

    /**
     * @param  array<string, mixed>  $validated
     */
    private function submittedPassword(array $validated): ?string
    {
        if (! isset($validated['password']) || ! is_string($validated['password']) || $validated['password'] === '') {
            return null;
        }

        return $validated['password'];
    }

    private function normalizeEmail(mixed $email): ?string
    {
        if (! is_string($email)) {
            return null;
        }

        $trimmed = trim($email);

        return $trimmed === '' ? null : $trimmed;
    }

    private function emailsDiffer(?string $current, ?string $next): bool
    {
        return trim((string) $current) !== trim((string) $next);
    }

    private function assertCurrentPassword(SettingsProfileRequest $request, string $username): void
    {
        // TODO(2fa-step-up): replace currentPassword with the step-up token (2FA plan §6).
        $this->currentPassword->assert(
            $username,
            $request->validated()['currentPassword'] ?? null,
            (string) ($request->ip() ?? ''),
        );
    }
}
