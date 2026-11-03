<?php

declare(strict_types=1);

namespace App\Services\Jmap\Guest;

use App\Exceptions\ApiHttpException;
use App\Models\DriveShareSession;
use App\Services\Drive\DriveShareAuthorizer;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;

/**
 * Opens the guest upload account for one request (#1715). Runs on every
 * guest JMAP request (Session, API, upload) before a body is read: the
 * session and its share must be live (DriveShareAuthorizer checks revoked,
 * expired, owner reach, and trash), the share root must be a folder, and the
 * guest must have `mayEditContent` there. Anything else is 403, so revoking
 * or lowering a link stops the very next part or create.
 */
final class GuestUploadGate
{
    private const SESSION_PREFIX = 'share:';

    private const ACCOUNT_PREFIX = 'guest-';

    public function __construct(
        private readonly DriveShareAuthorizer $authorizer,
        private readonly StoragePaths $paths,
        private readonly WgwStorage $storage,
        private readonly GuestJmapAccounts $accounts,
    ) {}

    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function open(array $principal): GuestUploadAccount
    {
        $sessionKey = self::sessionKey($principal);
        if ($sessionKey === null) {
            $this->forbid();
        }

        /** @var DriveShareSession|null $session */
        $session = DriveShareSession::query()->with('share')->where('session_key', $sessionKey)->first();
        $share = $session?->share;
        if ($share === null) {
            $this->forbid();
        }

        $rootPath = $this->paths->normalizeVirtualPath((string) $share->path);
        try {
            $context = $this->authorizer->resolvePathContext($rootPath, $principal);
        } catch (\InvalidArgumentException) {
            $this->forbid();
        }
        if (! $context['rights']['mayEditContent']) {
            $this->forbid();
        }

        $rootKey = $this->paths->virtualToStorageKey($rootPath);
        if ($rootKey === '' || ! $this->storage->files()->directoryExists($rootKey)) {
            $this->forbid();
        }

        $account = new GuestUploadAccount(
            accountId: self::accountIdFor($sessionKey),
            principal: ['username' => self::SESSION_PREFIX.$sessionKey, 'role' => 'guest'],
            shareId: (string) $share->id,
            rootPath: $rootPath,
            rootKey: $rootKey,
        );
        $this->accounts->register($account);

        return $account;
    }

    /**
     * `guest-` plus 32 hex of a hash of the session key: a JMAP Id, stable for
     * the session, and never the session key itself (it shows up in URLs).
     */
    public static function accountIdFor(string $sessionKey): string
    {
        return self::ACCOUNT_PREFIX.substr(hash('sha256', 'wgw-guest-upload:'.$sessionKey), 0, 32);
    }

    /**
     * The session key of a guest principal; null for anything else.
     *
     * @param  array<string, mixed>  $principal
     */
    public static function sessionKey(array $principal): ?string
    {
        if (strtolower(trim((string) ($principal['role'] ?? ''))) !== 'guest') {
            return null;
        }
        $username = (string) ($principal['username'] ?? '');
        if (! str_starts_with($username, self::SESSION_PREFIX)) {
            return null;
        }
        $key = substr($username, strlen(self::SESSION_PREFIX));

        return $key !== '' ? $key : null;
    }

    private function forbid(): never
    {
        throw new ApiHttpException(403, 'This share link does not allow uploads.', 'guest_upload_forbidden');
    }
}
