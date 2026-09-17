<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Settings;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\SettingsMailRequest;
use App\Http\Resources\Api\V1\SettingsStateResource;
use App\Models\Principal;
use App\Services\Mail\MailCredentialService;
use App\Services\Settings\SettingsStateService;
use Illuminate\Http\JsonResponse;

final class MailController
{
    public function __construct(
        private MailCredentialService $mailCredentials,
        private SettingsStateService $settings,
    ) {}

    public function __invoke(SettingsMailRequest $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $validated = $request->validated();
        $submittedLogin = trim((string) ($validated['imapUsername'] ?? ''));

        $this->syncProfileEmailFromMailLogin($principal['username'], $submittedLogin);

        $this->mailCredentials->saveAccount($principal['username'], $validated);

        return (new SettingsStateResource(
            $this->settings->forUsername($principal['username'])
        ))->response();
    }

    private function syncProfileEmailFromMailLogin(string $username, string $submittedLogin): void
    {
        if ($submittedLogin === '' || filter_var($submittedLogin, FILTER_VALIDATE_EMAIL) === false) {
            return;
        }

        $principal = Principal::forUsername($username);
        if ($principal === null) {
            return;
        }

        $principal->email = $submittedLogin;
        $principal->save();
    }
}
