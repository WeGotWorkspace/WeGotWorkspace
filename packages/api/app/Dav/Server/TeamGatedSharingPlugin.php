<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Teams\TeamColleagues;
use Sabre\DAV\Exception\Forbidden;
use Sabre\DAV\Sharing\ISharedNode;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Sabre\DAV\Xml\Element\Sharee;
use Sabre\DAVACL\Plugin as AclPlugin;

/**
 * Sabre's sharing plugin with the Epic #1915 Team gate. CS:share and DAV:share-resource
 * both end in {@see shareResource}. A grant to a user outside the caller's Teams, or to a
 * Team the caller is not in, is stored exactly like an address no principal matches:
 * without a principal, so it gives nobody access and the owner's shareWith omits it.
 */
final class TeamGatedSharingPlugin extends SharingPlugin
{
    public function __construct(private readonly TeamColleagues $colleagues) {}

    /**
     * @param  string  $path
     * @param  list<Sharee>  $sharees
     */
    public function shareResource($path, array $sharees): void
    {
        $node = $this->server->tree->getNodeForPath($path);
        if (! $node instanceof ISharedNode) {
            throw new Forbidden('Sharing is not allowed on this node');
        }

        $acl = $this->server->getPlugin('acl');
        if ($acl instanceof AclPlugin) {
            $acl->checkPrivileges($path, '{DAV:}share');
        }
        $caller = $this->callerUsername($acl instanceof AclPlugin ? $acl : null);

        // href => whether that invite already carries a principal.
        $existing = [];
        foreach ($node->getInvites() as $invite) {
            $existing[(string) $invite->href] = is_string($invite->principal) && $invite->principal !== '';
        }

        $forwarded = [];
        $stale = [];
        foreach ($sharees as $sharee) {
            $href = (string) $sharee->href;
            // Sabre resolves the href through the ACL plugin's getPrincipalByUri listener.
            $principal = $acl instanceof AclPlugin ? $acl->getPrincipalByUri($href) : null;
            $grants = $this->grantsAccess($sharee);
            if ($principal !== null && $caller !== null && $grants
                && ! $this->colleagues->mayShareWithPrincipalUri($caller, $principal)) {
                $principal = null;
            }
            if ($grants && isset($existing[$href])) {
                // Sabre updates an existing invite in place and keeps its principal, so a
                // grant that would be stored without one must not reach it (a refused
                // re-share, or a Team href no principal lookup resolves): the grant stays.
                if ($principal === null && $existing[$href]) {
                    continue;
                }
                // A principal-less row left by a refused share would stay principal-less
                // when updated in place; drop it so Sabre inserts a fresh row.
                if ($principal !== null && ! $existing[$href]) {
                    $stale[$href] = true;
                }
            }
            $sharee->principal = $principal;
            $forwarded[] = $sharee;
        }
        if ($stale !== []) {
            $node->updateInvites(array_map(
                static fn (string $href): Sharee => new Sharee(['href' => $href, 'access' => self::ACCESS_NOACCESS]),
                array_keys($stale),
            ));
        }
        if ($forwarded !== []) {
            $node->updateInvites($forwarded);
        }
    }

    private function grantsAccess(Sharee $sharee): bool
    {
        return (int) $sharee->access !== self::ACCESS_NOACCESS;
    }

    private function callerUsername(?AclPlugin $acl): ?string
    {
        $principal = $acl?->getCurrentUserPrincipal();
        if (! is_string($principal) || preg_match('#^principals/([^/]+)$#', $principal, $matches) !== 1 || $matches[1] === 'groups') {
            return null;
        }

        return $matches[1];
    }
}
