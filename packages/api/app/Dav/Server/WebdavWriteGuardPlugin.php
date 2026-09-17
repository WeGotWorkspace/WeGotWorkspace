<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Drive\DocAttachmentPaths;
use Sabre\DAV\Exception\Forbidden;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

/**
 * Restricts mutating WebDAV methods so users cannot destroy shared trees
 * (principals, top-level calendars/addressbooks/files) while keeping normal
 * CalDAV/CardDAV edits under {@code calendars/…} and {@code addressbooks/…},
 * and file edits only under {@code files/users/{username}/…} and {@code files/groups/{name}/…}.
 * Calendar/address book *homes* and *collections* cannot be deleted or moved/copied as a whole;
 * individual events ({@code …/calendar/object.ics}) and cards ({@code …/book/uuid.vcf}) still can.
 *
 * {@see beforeUnbind}/{@see beforeBind} run before Sabre’s ACL hooks so tree deletes/creates under
 * {@code principals/} and stray {@code files/…} paths are blocked even when ACL would allow unbind/bind.
 */
final class WebdavWriteGuardPlugin extends ServerPlugin
{
    private Server $server;

    public function initialize(Server $server): void
    {
        $this->server = $server;
        $server->on('beforeBind', [$this, 'beforeBind'], 5);
        $server->on('beforeUnbind', [$this, 'beforeUnbind'], 5);
        $server->on('beforeMethod:*', [$this, 'beforeMethod'], 15);
    }

    /**
     * Blocks creating any resource under {@code principals/} or outside allowed {@code files/…} areas.
     *
     * @param  string  $uri  path relative to the server base (no leading slash), same as {@see Tree} paths
     */
    public function beforeBind(string $uri): void
    {
        $path = self::normalizePath($uri);
        if (self::isPrincipalsSubtree($path)) {
            throw new Forbidden('Creating or replacing resources under principals/ is not allowed.');
        }
        if (self::isStrayFilesPath($path)) {
            throw new Forbidden('Creating files or folders is only allowed under files/users/{username}/ and files/groups/{group}/.');
        }
        if (DocAttachmentPaths::davIsProtected($path)) {
            throw new Forbidden('The .attachments tree is server-owned.');
        }
    }

    /**
     * Blocks removing principal resources, calendar/address book folder nodes, and stray {@code files/…} paths.
     * Covers internal {@see Tree::delete} paths that must not succeed even if HTTP {@see beforeMethod} differed.
     *
     * @param  string  $path  path relative to the server base
     */
    public function beforeUnbind(string $path): void
    {
        $p = self::normalizePath($path);
        if (self::isPrincipalsSubtree($p)) {
            throw new Forbidden('Deleting resources under principals/ is not allowed.');
        }
        if (self::isCalendarFolderPath($p)) {
            throw new Forbidden('Deleting a calendar home or calendar collection is not allowed.');
        }
        if (self::isAddressbookFolderPath($p)) {
            throw new Forbidden('Deleting an address book home or address book collection is not allowed.');
        }
        if (self::isStrayFilesPath($p)) {
            throw new Forbidden('Deleting this path under files/ is not allowed.');
        }
        if (DocAttachmentPaths::davIsProtected($p)) {
            throw new Forbidden('The .attachments tree is server-owned.');
        }
    }

    public function beforeMethod(RequestInterface $request, ResponseInterface $response): void
    {
        $method = $request->getMethod();
        if (! in_array($method, ['DELETE', 'MKCOL', 'PUT', 'MOVE', 'COPY', 'PROPPATCH', 'PATCH'], true)) {
            return;
        }

        $path = $request->getPath();

        if (self::isPrincipalsSubtree($path)) {
            throw new Forbidden('Changing resources under principals/ is not allowed.');
        }
        if (self::isStrayFilesPath($path)) {
            throw new Forbidden('Changing this path under files/ is not allowed.');
        }
        if (DocAttachmentPaths::davIsProtected($path)) {
            throw new Forbidden('The .attachments tree is server-owned.');
        }

        if ($method === 'DELETE') {
            if (self::isCalendarFolderPath($path)) {
                throw new Forbidden('Deleting a calendar home or calendar collection is not allowed.');
            }
            if (self::isAddressbookFolderPath($path)) {
                throw new Forbidden('Deleting an address book home or address book collection is not allowed.');
            }
        }

        if ($method === 'MOVE' || $method === 'COPY') {
            $destHeader = $request->getHeader('Destination');
            if ($destHeader === null || $destHeader === '') {
                return;
            }
            try {
                $destPath = $this->server->calculateUri($destHeader);
            } catch (\Throwable) {
                throw new Forbidden('Invalid Destination.');
            }
            if (self::isPrincipalsSubtree($path) || self::isPrincipalsSubtree($destPath)) {
                throw new Forbidden('Moving or copying resources under principals/ is not allowed.');
            }
            if (self::isStrayFilesPath($path) || self::isStrayFilesPath($destPath)) {
                throw new Forbidden('Moving or copying to or from this path under files/ is not allowed.');
            }
            if (DocAttachmentPaths::davIsProtected($path) || DocAttachmentPaths::davIsProtected($destPath)) {
                throw new Forbidden('The .attachments tree is server-owned.');
            }
            if (self::isCalendarFolderPath($path) || self::isCalendarFolderPath($destPath)) {
                throw new Forbidden('Moving or copying calendar homes or calendar collections is not allowed.');
            }
            if (self::isAddressbookFolderPath($path) || self::isAddressbookFolderPath($destPath)) {
                throw new Forbidden('Moving or copying address book homes or address book collections is not allowed.');
            }
            $zSrc = self::mutationZone($path);
            $zDst = self::mutationZone($destPath);
            if ($zSrc === 0 || $zDst === 0 || $zSrc !== $zDst) {
                throw new Forbidden(self::message());
            }

            return;
        }

        if (self::mutationZone($path) === 0) {
            throw new Forbidden(self::message());
        }
    }

    private static function normalizePath(string $path): string
    {
        return trim($path, '/');
    }

    private static function isPrincipalsSubtree(string $path): bool
    {
        $p = self::normalizePath($path);

        return $p === 'principals' || str_starts_with($p, 'principals/');
    }

    /**
     * True for {@code files}, {@code files/users}, {@code files/groups}, or any {@code files/…} path that is
     * not under {@code files/users/{user}/} or {@code files/groups/{group}/}.
     */
    private static function isStrayFilesPath(string $path): bool
    {
        $p = self::normalizePath($path);
        if ($p === 'files' || $p === 'files/users' || $p === 'files/groups') {
            return true;
        }
        if (! str_starts_with($p, 'files/')) {
            return false;
        }
        if (preg_match('#^files/users/[^/]+(/|$)#', $p) === 1) {
            return false;
        }
        if (preg_match('#^files/groups/[^/]+(/|$)#', $p) === 1) {
            return false;
        }

        return true;
    }

    private static function message(): string
    {
        return 'Changes are only allowed under files/users/{username}/, files/groups/{group}/, calendars/, and addressbooks/.';
    }

    /**
     * Calendar home ({@code calendars/{user}}) or a calendar collection ({@code calendars/{user}/{id}}), not a calendar object (4+ segments).
     */
    private static function isCalendarFolderPath(string $path): bool
    {
        $p = self::normalizePath($path);
        if (! str_starts_with($p, 'calendars/')) {
            return false;
        }
        $n = substr_count($p, '/') + 1;

        return $n >= 2 && $n <= 3;
    }

    /**
     * Address book home or address book collection, not a single vCard (4+ segments).
     */
    private static function isAddressbookFolderPath(string $path): bool
    {
        $p = self::normalizePath($path);
        if (! str_starts_with($p, 'addressbooks/')) {
            return false;
        }
        $n = substr_count($p, '/') + 1;

        return $n >= 2 && $n <= 3;
    }

    /**
     * Non-zero zones must match for MOVE/COPY source and destination.
     */
    private static function mutationZone(string $path): int
    {
        $p = self::normalizePath($path);
        if ($p === 'files' || $p === 'files/users' || $p === 'files/groups') {
            return 0;
        }
        if (preg_match('#^files/users/[^/]+(/|$)#', $p) === 1) {
            return 10;
        }
        if (preg_match('#^files/groups/[^/]+(/|$)#', $p) === 1) {
            return 20;
        }
        if ($p === 'calendars') {
            return 0;
        }
        if (str_starts_with($p, 'calendars/')) {
            return 30;
        }
        if ($p === 'addressbooks') {
            return 0;
        }
        if (str_starts_with($p, 'addressbooks/')) {
            return 40;
        }
        if (self::isPrincipalsSubtree($p)) {
            return 0;
        }
        if (str_starts_with($p, 'files/')) {
            return 0;
        }

        return 0;
    }
}
