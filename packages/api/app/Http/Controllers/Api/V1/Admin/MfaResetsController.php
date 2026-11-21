<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Admin;

use App\Exceptions\ApiHttpException;
use App\Models\User;
use App\Services\Auth\Mfa\UserMfaService;
use Illuminate\Http\JsonResponse;

/**
 * Admin reset of a user's two-factor (#2273), for a lost phone or a secret
 * that no longer decrypts. Same as `php artisan wgw:mfa:reset <username>`.
 */
final class MfaResetsController
{
    public function __construct(private UserMfaService $mfa) {}

    public function __invoke(string $username): JsonResponse
    {
        $username = strtolower(trim($username));
        if (! User::query()->where('username', $username)->exists()) {
            throw new ApiHttpException(404, 'User not found.', 'not_found');
        }
        $this->mfa->reset($username);

        return response()->json(['ok' => true]);
    }
}
