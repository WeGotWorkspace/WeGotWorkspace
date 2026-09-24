<?php

declare(strict_types=1);

namespace App\Services\Home;

use App\Services\Auth\AdminRoleResolver;
use App\Support\AppPaths;
use App\Support\WgwSettings;

final class HomeStateService
{
    public function __construct(
        private AppPaths $paths,
        private AdminRoleResolver $adminRoles,
    ) {}

    /**
     * @return array{
     *   username: string,
     *   isAdmin: bool,
     *   availability: array<string, bool>
     * }
     */
    public function forUsername(string $username): array
    {
        $cfg = WgwSettings::normalized();
        $filesEnabled = (bool) ($cfg[WgwSettings::FILES_ENABLED] ?? true);

        return [
            'username' => $username,
            'isAdmin' => $this->adminRoles->isAdmin($username),
            'availability' => [
                'filesEnabled' => $filesEnabled,
                'drive' => $filesEnabled && $this->paths->appDistIndex('drive') !== null,
                'mail' => false,
                'meet' => $filesEnabled && $this->paths->appDistIndex('meet') !== null,
                'notes' => $filesEnabled && $this->paths->appDistIndex('notes') !== null,
            ],
        ];
    }
}
