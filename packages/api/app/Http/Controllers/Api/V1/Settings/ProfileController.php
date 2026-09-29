<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Settings;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\SettingsProfileRequest;
use App\Http\Resources\Api\V1\SettingsStateResource;
use App\Services\Auth\AuthTokenService;
use App\Services\Auth\UiSessionService;
use App\Services\Settings\SettingsStateService;
use App\Services\Settings\UserProfileService;
use Illuminate\Http\JsonResponse;

final class ProfileController
{
    public function __construct(
        private UserProfileService $profiles,
        private SettingsStateService $settings,
        private AuthTokenService $tokens,
        private UiSessionService $uiSession,
    ) {}

    public function __invoke(SettingsProfileRequest $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $validated = $request->validated();

        $this->profiles->updateProfile(
            $principal['username'],
            trim((string) ($validated['displayName'] ?? '')),
            isset($validated['email']) && is_string($validated['email']) && trim($validated['email']) !== ''
                ? trim($validated['email'])
                : null
        );

        $password = isset($validated['password']) && is_string($validated['password'])
            ? $validated['password']
            : '';
        if ($password !== '') {
            $this->profiles->updatePassword($principal['username'], $password);
        }

        $state = $this->settings->forUsername($principal['username']);
        if ($password === '') {
            return (new SettingsStateResource($state))->response();
        }

        $username = $principal['username'];

        return response()
            ->json($state + $this->tokens->issueForUsername($username))
            ->withCookie($this->uiSession->issueForRequest($username));
    }
}
