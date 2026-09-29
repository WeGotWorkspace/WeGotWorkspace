<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Admin;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\AdminGroupCreateRequest;
use App\Http\Requests\Api\V1\AdminGroupUpdateRequest;
use App\Services\Admin\AdminGroupManagementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class GroupsController
{
    public function __construct(private AdminGroupManagementService $groups) {}

    public function store(AdminGroupCreateRequest $request): JsonResponse
    {
        $slugRaw = $request->slugValue();
        if ($slugRaw === '') {
            throw new ApiHttpException(400, 'Group name is required.', 'bad_request');
        }

        try {
            $slug = $this->groups->normalizeSlug($slugRaw);
            $this->groups->create($slug, $request->displayNameValue());
        } catch (\InvalidArgumentException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        }

        return response()->json(['ok' => true]);
    }

    public function update(AdminGroupUpdateRequest $request, string $group): JsonResponse
    {
        /** @var array{username: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $validated = $request->validated();

        try {
            $this->groups->update(
                $group,
                array_key_exists('displayName', $validated)
                    ? trim((string) ($validated['displayName'] ?? ''))
                    : null,
                array_key_exists('members', $validated) && is_array($validated['members'])
                    ? array_values(array_filter($validated['members'], is_string(...)))
                    : null,
                $principal['username'],
            );
        } catch (\InvalidArgumentException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        }

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request, string $group): JsonResponse
    {
        try {
            $this->groups->delete($group);
        } catch (\InvalidArgumentException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        }

        return response()->json(['ok' => true]);
    }
}
