<?php

declare(strict_types=1);

namespace App\Services\Jmap\Guest;

/**
 * The JMAP account of one guest session whose share link allows uploads
 * (#1715): its own blob space, the share root as its only root, and the
 * guest principal that DriveShareAuthorizer checks on every write.
 */
final readonly class GuestUploadAccount
{
    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function __construct(
        public string $accountId,
        public array $principal,
        public string $shareId,
        public string $rootPath,
        public string $rootKey,
    ) {}
}
