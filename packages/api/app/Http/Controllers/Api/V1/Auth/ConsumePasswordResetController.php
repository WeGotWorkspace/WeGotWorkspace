<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Requests\Api\V1\PasswordResetConsumeRequest;
use App\Services\Auth\PasswordRecoveryService;
use Illuminate\Http\JsonResponse;

final class ConsumePasswordResetController
{
    public function __construct(private PasswordRecoveryService $recovery) {}

    public function __invoke(PasswordResetConsumeRequest $request, string $token): JsonResponse
    {
        $validated = $request->validated();
        $this->recovery->consumeReset($token, (string) $validated['password']);

        return response()->json(['ok' => true]);
    }
}
