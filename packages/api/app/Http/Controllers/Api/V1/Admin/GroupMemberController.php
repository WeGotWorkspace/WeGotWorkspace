<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Admin;

use App\Exceptions\ApiHttpException;
use App\Services\Admin\AdminConstants;
use App\Services\Settings\GroupDirectoryService;
use Illuminate\Http\JsonResponse;

final class GroupMemberController
{
    public function __construct(private GroupDirectoryService $groups) {}

    public function store(string $group, string $username): JsonResponse
    {
        return $this->mutate($group, $username, true);
    }

    public function destroy(string $group, string $username): JsonResponse
    {
        return $this->mutate($group, $username, false);
    }

    private function mutate(string $group, string $username, bool $enabled): JsonResponse
    {
        if (! preg_match('/^[a-z0-9_-]{2,63}$/', $group) || ! preg_match('/^[a-z0-9_-]{2,63}$/', $username)) {
            throw new ApiHttpException(400, 'Invalid team or username.', 'bad_request');
        }

        try {
            $this->groups->setMembership(
                AdminConstants::GROUP_PREFIX.$group,
                strtolower($username),
                $enabled,
            );
        } catch (\InvalidArgumentException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        }

        return response()->json(['ok' => true]);
    }
}
