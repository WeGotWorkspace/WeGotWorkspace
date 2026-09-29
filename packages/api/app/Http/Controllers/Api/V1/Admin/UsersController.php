<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Admin;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\AdminUserCreateRequest;
use App\Http\Requests\Api\V1\AdminUserUpdateRequest;
use App\Services\Admin\AdminUserProvisionerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class UsersController
{
    public function __construct(private AdminUserProvisionerService $users) {}

    public function store(AdminUserCreateRequest $request): JsonResponse
    {
        /** @var array{username: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $validated = $request->validated();

        try {
            $groups = $validated['groups'] ?? [];
            $this->users->create(
                (string) $validated['username'],
                (string) $validated['password'],
                trim((string) ($validated['displayName'] ?? '')),
                isset($validated['email']) ? trim((string) $validated['email']) : null,
                is_array($groups) ? array_values(array_filter($groups, is_string(...))) : [],
                $principal['username'],
            );
        } catch (\InvalidArgumentException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        }

        return response()->json(['ok' => true]);
    }

    public function update(AdminUserUpdateRequest $request, string $username): JsonResponse
    {
        /** @var array{username: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        try {
            $this->users->update($username, $request->validated(), $principal['username']);
        } catch (\InvalidArgumentException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        }

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request, string $username): JsonResponse
    {
        try {
            $this->users->delete($username);
        } catch (\InvalidArgumentException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        }

        return response()->json(['ok' => true]);
    }
}
