<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Admin;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\AdminMfaResetRequest;
use App\Models\User;
use App\Services\Auth\MfaReauth;
use App\Services\Auth\MfaSessionReissue;
use App\Services\Auth\RecoveryCodeService;
use App\Services\Auth\UserMfaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class MfaAdminController
{
    public function __construct(
        private UserMfaService $mfa,
        private MfaReauth $reauth,
        private MfaSessionReissue $sessionReissue,
        private RecoveryCodeService $recoveryCodes,
    ) {}

    public function reset(AdminMfaResetRequest $request, string $username): JsonResponse
    {
        $admin = $this->username($request);
        $username = strtolower(trim($username));
        if ($username !== strtolower(trim((string) $request->validated()['confirm_username']))) {
            throw new ApiHttpException(422, 'Type the username to confirm the reset.', 'bad_request');
        }
        if (! User::query()->where('username', $username)->exists()) {
            throw new ApiHttpException(404, 'User not found.', 'not_found');
        }

        $this->reauth->assert($admin, null, (string) $request->validated()['code']);
        $this->mfa->disable($username);
        $this->recoveryCodes->deleteAll($username);
        $this->sessionReissue->afterAuthenticatorChanged($username);

        return response()->json(['ok' => true]);
    }

    private function username(Request $request): string
    {
        /** @var array{username: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return (string) $principal['username'];
    }
}
