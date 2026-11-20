<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Settings;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\AppPasswordCreateRequest;
use App\Services\Auth\AppPasswordService;
use App\Services\Auth\CurrentPasswordCheck;
use App\Services\Auth\Mfa\CurrentCodeCheck;
use App\Services\Auth\Mfa\UserMfaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Named app passwords of the caller (#2271). Every query is scoped to the
 * signed-in username; an id of another user answers 404.
 */
final class AppPasswordsController
{
    public function __construct(
        private AppPasswordService $appPasswords,
        private CurrentPasswordCheck $currentPassword,
        private UserMfaService $mfa,
        private CurrentCodeCheck $currentCode,
    ) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json(['appPasswords' => $this->appPasswords->listFor($this->username($request))]);
    }

    public function store(AppPasswordCreateRequest $request): JsonResponse
    {
        $username = $this->username($request);
        $validated = $request->validated();
        $ip = (string) ($request->ip() ?? '');
        $code = is_string($validated['code'] ?? null) ? trim($validated['code']) : '';
        $password = is_string($validated['currentPassword'] ?? null) ? $validated['currentPassword'] : '';

        if ($this->mfa->isEnabled($username)) {
            // Two-factor on (#2273): a current authenticator code, never the
            // account password.
            if ($code === '') {
                throw new ApiHttpException(422, 'Enter the code from your authenticator app.', 'mfa_code_required', ['code']);
            }
            $this->currentCode->assert($username, $code, $ip);
        } else {
            if ($password === '') {
                // Unchanged from before two-factor: a validation error (400).
                throw new ApiHttpException(400, 'The current password field is required.', 'bad_request', ['currentPassword']);
            }
            $this->currentPassword->assert($username, $password, $ip);
        }

        return response()->json($this->appPasswords->create($username, (string) $validated['name']), 201);
    }

    public function destroy(Request $request, int $appPasswordId): JsonResponse
    {
        $this->appPasswords->revoke($this->username($request), $appPasswordId);

        return response()->json(['ok' => true]);
    }

    public function revokeAll(Request $request): JsonResponse
    {
        $this->appPasswords->revokeAll($this->username($request));

        return response()->json(['ok' => true]);
    }

    private function username(Request $request): string
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return $principal['username'];
    }
}
