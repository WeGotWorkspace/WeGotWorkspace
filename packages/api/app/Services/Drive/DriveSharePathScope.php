<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Storage\StoragePaths;

final class DriveSharePathScope
{
    public function __construct(private StoragePaths $paths) {}

    public function normalize(string $path): string
    {
        return $this->paths->normalizeVirtualPath($path);
    }

    /**
     * True for personal/group drive roots (`/users/{username}`, `/groups/{slug}`).
     * Those roots are not share targets; children under them may be shared.
     */
    public function isTopLevelDrive(string $path): bool
    {
        $segments = explode('/', ltrim($this->normalize($path), '/'));

        return count($segments) === 2
            && ($segments[0] === 'users' || $segments[0] === 'groups')
            && $segments[1] !== '';
    }

    public function isWithin(string $rootPath, string $requestedPath): bool
    {
        $root = $this->normalize($rootPath);
        $path = $this->normalize($requestedPath);

        if ($root === '/') {
            return true;
        }

        return $path === $root || str_starts_with($path, $root.'/');
    }
}
