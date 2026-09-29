<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Auth\MfaAccountStatus;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class MeController
{
    public function __construct(private MfaAccountStatus $mfa) {}

    public function __invoke(Request $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json([
            'username' => $principal['username'],
            'role' => $principal['role'],
            'mfa' => $this->mfa->forUsername($principal['username']),
        ]);
    }
}
