<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Requests\Api\V1\PasswordResetRequestRequest;
use App\Services\Auth\PasswordRecoveryService;
use Illuminate\Http\JsonResponse;

final class RequestPasswordResetController
{
    public function __construct(private PasswordRecoveryService $recovery) {}

    public function __invoke(PasswordResetRequestRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $this->recovery->requestReset(
            (string) $validated['identifier'],
            (string) $request->ip()
        );

        return response()->json(['ok' => true]);
    }
}
