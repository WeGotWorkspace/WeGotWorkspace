<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Requests\Api\V1\AuthTokenRequest;
use App\Services\Auth\AuthTokenService;
use Illuminate\Http\JsonResponse;

final class TokenController
{
    public function __construct(private AuthTokenService $authTokens) {}

    public function __invoke(AuthTokenRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $payload = $this->authTokens->issueFromCredentials(
            (string) $validated['username'],
            (string) $validated['password'],
            (string) $request->ip()
        );

        return response()->json($payload);
    }
}
