<?php

declare(strict_types=1);

namespace App\Services\Docs;

use App\Exceptions\ApiHttpException;
use App\Services\Admin\AdminConstants;

/**
 * DAV-hidden VJOURNAL storage pool for Docs comment/suggestion threads.
 *
 * One collection per file-owner principal — an implementation bucket, not a
 * product channel. No calendar shareWith; ACL is DriveShareAuthorizer only.
 */
final class DocsThreadCollectionUris
{
    public const POOL_URI = 'docs-threads';

    public const HIDDEN_PREFIX = 'docs-threads';

    public static function ownerPrincipalUri(string $normalizedPath): string
    {
        $segments = explode('/', ltrim($normalizedPath, '/'));
        $root = $segments[0] ?? '';
        $owner = strtolower(trim((string) ($segments[1] ?? '')));
        if ($owner === '') {
            throw new ApiHttpException(400, 'Threads require a user or group file path.', 'bad_request');
        }
        if ($root === 'users') {
            return 'principals/'.$owner;
        }
        if ($root === 'groups') {
            return AdminConstants::GROUP_PREFIX.$owner;
        }

        throw new ApiHttpException(400, 'Threads require a user or group file path.', 'bad_request');
    }
}
