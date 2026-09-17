<?php

declare(strict_types=1);

namespace App\Services\Drive;

/**
 * Hidden Doc attachments tree: /{users|groups}/{principal}/.attachments/{docFnId}/…
 *
 * Indexed like .Trash, browse-hidden, and ACL-inherited from the Doc FileNode.
 */
final class DocAttachmentPaths
{
    public const DIR = '.attachments';

    /**
     * @return array{kind: string, principal: string, docNodeId: string}|null
     */
    public static function parseStorageKey(string $key): ?array
    {
        $key = self::normalizeKey($key);
        if (preg_match('#^(users|groups)/([^/]+)/\.attachments/(fn-[0-9a-f]{32})(?:/.*)?$#', $key, $matches) !== 1) {
            return null;
        }

        return [
            'kind' => $matches[1],
            'principal' => $matches[2],
            'docNodeId' => $matches[3],
        ];
    }

    public static function isAttachmentsRootKey(string $key): bool
    {
        return preg_match('#^(users|groups)/[^/]+/\.attachments$#', self::normalizeKey($key)) === 1;
    }

    public static function isUnderAttachmentsKey(string $key): bool
    {
        return self::parseStorageKey($key) !== null || self::isAttachmentsRootKey($key);
    }

    public static function isDocFolderKey(string $key, string $docNodeId): bool
    {
        $key = self::normalizeKey($key);

        return preg_match(
            '#^(users|groups)/[^/]+/\.attachments/'.preg_quote($docNodeId, '#').'$#',
            $key,
        ) === 1;
    }

    public static function folderKey(string $principalPrefix, string $docNodeId): string
    {
        return self::attachmentsRootKey($principalPrefix).'/'.$docNodeId;
    }

    public static function attachmentsRootKey(string $principalPrefix): string
    {
        return self::normalizeKey($principalPrefix).'/'.self::DIR;
    }

    public static function principalPrefix(string $storageKey): ?string
    {
        if (preg_match('#^(users|groups)/[^/]+#', self::normalizeKey($storageKey), $matches) !== 1) {
            return null;
        }

        return $matches[0];
    }

    public static function isHiddenBrowseVirtualPath(string $virtualPath): bool
    {
        return preg_match('#^/(?:users|groups)/[^/]+/\.attachments(?:/|$)#', $virtualPath) === 1;
    }

    public static function davIsProtected(string $davPath): bool
    {
        $path = trim(str_replace('\\', '/', $davPath), '/');

        return preg_match('#^files/(users|groups)/[^/]+/\.attachments(?:/|$)#', $path) === 1;
    }

    private static function normalizeKey(string $key): string
    {
        return trim(str_replace('\\', '/', $key), '/');
    }
}
