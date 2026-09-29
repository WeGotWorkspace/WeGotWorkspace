<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Settings;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\AppPasswordCreateRequest;
use App\Http\Requests\Api\V1\AppPasswordRevokeAllRequest;
use App\Models\AppSetting;
use App\Services\Auth\AppPasswordService;
use App\Services\Auth\SabreCredentialValidator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class AppPasswordsController
{
    public function __construct(
        private AppPasswordService $appPasswords,
        private SabreCredentialValidator $credentials,
    ) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'appPasswords' => $this->appPasswords->listFor($this->username($request)),
        ]);
    }

    public function store(AppPasswordCreateRequest $request): JsonResponse
    {
        $username = $this->username($request);
        $validated = $request->validated();
        $this->assertAccountPassword($username, (string) $validated['password']);
        $created = $this->appPasswords->create($username, trim((string) $validated['name']));

        return response()->json($created, 201);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $this->appPasswords->revoke($this->username($request), $id);

        return response()->json(['ok' => true]);
    }

    public function revokeAll(AppPasswordRevokeAllRequest $request): JsonResponse
    {
        $username = $this->username($request);
        $this->assertAccountPassword($username, (string) $request->validated()['password']);
        $this->appPasswords->revokeAll($username);

        return response()->json(['ok' => true]);
    }

    private function username(Request $request): string
    {
        /** @var array{username: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return (string) $principal['username'];
    }

    private function assertAccountPassword(string $username, string $password): void
    {
        $realm = (string) AppSetting::getValue('auth_realm', (string) config('wgw.auth_realm'));
        if (! $this->credentials->validate($username, $password, $realm)) {
            throw new ApiHttpException(401, 'Invalid credentials.', 'unauthorized');
        }
    }
}
