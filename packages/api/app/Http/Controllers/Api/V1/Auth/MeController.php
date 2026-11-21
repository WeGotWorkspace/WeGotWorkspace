<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Resources\Api\V1\PrincipalResource;
use App\Services\Auth\Mfa\UserMfaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class MeController
{
    public function __construct(private UserMfaService $mfa) {}

    public function __invoke(Request $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $principal['mfa'] = $this->mfa->status($principal['username']);

        return (new PrincipalResource($principal))->response();
    }
}
